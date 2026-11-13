import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/scheduling/booking";
import { processOutbox } from "@/lib/whatsapp/outbox";
import { classifyMetaError, mockSent, mockWhatsappFailNext, parseMetaPayload } from "@/lib/whatsapp/provider";
import { handleWhatsappEvents, provisionTemplates, saveAndTestConnection } from "@/lib/whatsapp/service";
import { DEFAULT_TEMPLATES, isOptOutText, templateCreatePayload } from "@/lib/whatsapp/templates";
import { NOW, at, customer, makeTenant, resetDb } from "./helpers";

beforeEach(resetDb);

async function connected() {
  const T = await makeTenant();
  await saveAndTestConnection(T.tenant.id, "u", { phoneNumberId: "1065403522", wabaId: "1022901293", accessToken: "EAAG-token", sendWindowStart: "00:00", sendWindowEnd: "23:59" });
  return T;
}

const webhook = (value: object, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1022901293", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5511900000000", phone_number_id: "1065403522" }, ...value } }] }],
});

describe("templates padrão (regras da Meta)", () => {
  it("nomes válidos, variável nem no início nem no fim, rodapé curto, exemplo do botão só com o valor", () => {
    for (const d of DEFAULT_TEMPLATES) {
      expect(d.name).toMatch(/^[a-z0-9_]+$/);
      expect(d.body.trim().startsWith("{{")).toBe(false);
      expect(d.body.trim().endsWith("}}")).toBe(false);
      expect(d.body.length).toBeLessThanOrEqual(1024);
      const p = templateCreatePayload(d) as { components: { type: string; text?: string; buttons?: { type: string; url?: string; example?: string[]; text: string }[] }[] };
      const footer = p.components.find((c) => c.type === "FOOTER")!;
      expect(footer.text!.length).toBeLessThanOrEqual(60);
      const buttons = p.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
      for (const b of buttons) expect(b.text.length).toBeLessThanOrEqual(25);
      const url = buttons.find((b) => b.type === "URL");
      if (url) {
        expect(url.url!.endsWith("{{1}}")).toBe(true);
        expect(url.example).toEqual(["exemplo123"]);
      }
    }
  });
  it("opt-out reconhece variações", () => {
    expect(isOptOutText("SAIR")).toBe(true);
    expect(isOptOutText(" Parar! ")).toBe(true);
    expect(isOptOutText("Não quero mais")).toBe(true);
    expect(isOptOutText("quero sair do horário das 10")).toBe(false);
  });
});

describe("conexão e provisionamento (mock da Meta)", () => {
  it("valida o número e cria os 7 templates", async () => {
    const T = await connected();
    const conn = await prisma.whatsappConnection.findFirstOrThrow({});
    expect(conn).toMatchObject({ status: "connected", verifiedName: "Negócio de teste", qualityRating: "GREEN" });
    expect(conn.encryptedCredentials).not.toContain("EAAG-token");
    const r = await provisionTemplates(T.tenant.id, "u");
    expect(r).toHaveLength(7);
    expect(await prisma.messageTemplate.count({ where: { status: "APPROVED" } })).toBe(7);
  });
  it("um número não pode ser conectado a duas empresas", async () => {
    await connected();
    const B = await makeTenant();
    await expect(
      saveAndTestConnection(B.tenant.id, "u", { phoneNumberId: "1065403522", wabaId: "1", accessToken: "x", sendWindowStart: "08:00", sendWindowEnd: "21:00" }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("webhook da Meta", () => {
  it("interpreta status, texto, botão e status de template", () => {
    const ev = parseMetaPayload(
      webhook({
        statuses: [{ id: "wamid.A", status: "failed", timestamp: "1", recipient_id: "5511", errors: [{ code: 131049, title: "ecosystem" }] }],
        contacts: [{ profile: { name: "Carla" }, wa_id: "5511988887777", user_id: "BR.123" }],
        messages: [
          { from: "5511988887777", id: "wamid.T", type: "text", text: { body: "SAIR" } },
          { from: "5511988887777", id: "wamid.B", type: "button", button: { payload: "Confirmo presença", text: "Confirmo presença" }, context: { id: "wamid.X" } },
        ],
      }),
    );
    expect(ev[0]).toMatchObject({ kind: "status", status: "failed", errorCode: 131049 });
    expect(ev[1]).toMatchObject({ kind: "message", type: "text", text: "SAIR", fromPhone: "+5511988887777", fromUserId: "BR.123" });
    expect(ev[2]).toMatchObject({ kind: "message", type: "button", contextMessageId: "wamid.X" });
    const t = parseMetaPayload({ entry: [{ id: "W1", changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_id: 9, message_template_name: "amser_lembrete", message_template_language: "pt-BR", reason: "NONE" } }] }] });
    expect(t[0]).toMatchObject({ kind: "template_status", status: "APPROVED", language: "pt_BR" });
  });

  it("botão 'Confirmo presença' confirma o agendamento; mensagem repetida é ignorada", async () => {
    const T = await connected();
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: T.pros[0].id, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    await prisma.messageOutbox.updateMany({ where: { eventType: "presence_request" }, data: { scheduledAt: new Date(0) } });
    await processOutbox(new Date());
    const presence = await prisma.messageOutbox.findFirstOrThrow({ where: { eventType: "presence_request" } });
    expect(presence.status).toBe("sent");
    const sentTpl = mockSent.find((m) => "templateName" in m && m.templateName === "amser_confirmar_presenca") as { templateName: string; buttonUrlParam?: string };
    expect(sentTpl).toBeTruthy();
    expect(sentTpl.buttonUrlParam).toBeUndefined(); // template de presença não tem botão URL

    const payload = webhook({ messages: [{ from: "5511988887777", id: "wamid.REPLY1", type: "button", button: { text: "Confirmo presença", payload: "Confirmo presença" }, context: { id: presence.providerMessageId } }] });
    const s1 = await handleWhatsappEvents(parseMetaPayload(payload));
    expect(s1.confirmations).toBe(1);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe("confirmado");
    const s2 = await handleWhatsappEvents(parseMetaPayload(payload));
    expect(s2.messages).toBe(0);
  });

  it("'SAIR' revoga o consentimento e cancela mensagens pendentes", async () => {
    const T = await connected();
    await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(await prisma.messageOutbox.count({ where: { status: "pending" } })).toBeGreaterThan(0);
    await handleWhatsappEvents(parseMetaPayload(webhook({ messages: [{ from: "5511988887777", id: "wamid.S", type: "text", text: { body: "sair" } }] })));
    const c = await prisma.customer.findFirstOrThrow({});
    expect(c.optedOutAt).not.toBeNull();
    expect((c.consentJson as Record<string, unknown>).whatsapp).toBe(false);
    expect(await prisma.messageOutbox.count({ where: { status: "pending" } })).toBe(0);
  });

  it("status fora de ordem não regride; falha 130403 (bloqueado) gera opt-out", async () => {
    const T = await connected();
    await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    await processOutbox(new Date());
    const m = await prisma.messageOutbox.findFirstOrThrow({ where: { status: "sent" } });
    await handleWhatsappEvents(parseMetaPayload(webhook({ statuses: [{ id: m.providerMessageId, status: "read", timestamp: "2", recipient_id: "x" }] })));
    await handleWhatsappEvents(parseMetaPayload(webhook({ statuses: [{ id: m.providerMessageId, status: "delivered", timestamp: "1", recipient_id: "x" }] })));
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("read");
    await handleWhatsappEvents(parseMetaPayload(webhook({ statuses: [{ id: m.providerMessageId, status: "failed", timestamp: "3", recipient_id: "x", errors: [{ code: 130403, title: "blocked" }] }] })));
    expect((await prisma.customer.findFirstOrThrow({})).optedOutAt).not.toBeNull();
  });
});

describe("erros de envio", () => {
  it("classificação conforme os códigos da Meta", () => {
    expect(classifyMetaError(130429, "rate").retryable).toBe(true);
    expect(classifyMetaError(131056, "pair").retryable).toBe(true);
    expect(classifyMetaError(131026, "undeliverable").retryable).toBe(false);
    expect(classifyMetaError(190, "token")).toMatchObject({ retryable: false, kind: "auth" });
    expect(classifyMetaError(131050, "stop")).toMatchObject({ retryable: false, kind: "opt_out" });
    expect(classifyMetaError(132001, "tpl")).toMatchObject({ kind: "template" });
  });
  it("token inválido marca a conexão com erro e não insiste", async () => {
    const T = await connected();
    await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    mockWhatsappFailNext(1, 190);
    await processOutbox(new Date());
    expect((await prisma.whatsappConnection.findFirstOrThrow({})).status).toBe("error");
    expect(await prisma.messageOutbox.count({ where: { status: "dead" } })).toBe(1);
  });
});
