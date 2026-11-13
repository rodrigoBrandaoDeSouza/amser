import { beforeEach, describe, expect, it } from "vitest";
import type { MessageEvent } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/scheduling/booking";
import { processOutbox } from "@/lib/whatsapp/outbox";
import { getMessageSettings, previewMessage, saveMessageSettings, MESSAGE_INFO } from "@/lib/messages";
import { createCustomer, updateCustomer } from "@/lib/crm";
import { NOW, at, customer, makeTenant, resetDb } from "./helpers";

beforeEach(resetDb);

const allOn = () => Object.fromEntries(MESSAGE_INFO.map((m) => [m.event, true])) as Record<MessageEvent, boolean>;
const base = { reminderHours: [24, 2], presenceRequestHours: 24, presenceDeadlineHours: 3, autoReleaseUnconfirmed: false, waitlistEnabled: true, sendWindowStart: "00:00", sendWindowEnd: "23:59" };

describe("mensagens automáticas", () => {
  it("desligar um tipo cancela os da fila e impede novos envios", async () => {
    const T = await makeTenant();
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(await prisma.messageOutbox.count({ where: { eventType: "reminder", status: "pending" } })).toBeGreaterThan(0);

    await saveMessageSettings(T.tenant.id, "u", { ...base, enabled: { ...allOn(), reminder: false } });
    expect(await prisma.messageOutbox.count({ where: { eventType: "reminder", status: "pending" } })).toBe(0);

    // Um lembrete criado depois (ex.: remarcação) também não sai.
    await prisma.messageOutbox.create({
      data: { tenantId: T.tenant.id, appointmentId: r.appointment.id, eventType: "reminder", toPhoneE164: "+5511988887777", payloadJson: { startsAt: r.appointment.startsAt.toISOString(), customerName: "C", serviceName: "S", tenantName: "T", when: "x", token: "t" }, idempotencyKey: "x1", scheduledAt: new Date(0) },
    });
    await processOutbox(new Date());
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { idempotencyKey: "x1" } })).status).toBe("skipped");

    const s = await getMessageSettings(T.tenant.id);
    expect(s.events.find((e) => e.event === "reminder")?.enabled).toBe(false);
    expect(s.events.find((e) => e.event === "booking_confirmed")?.enabled).toBe(true);
  });

  it("salva horários e janela; valida prazos", async () => {
    const T = await makeTenant();
    await saveMessageSettings(T.tenant.id, "u", { ...base, enabled: allOn(), reminderHours: [2, 48, 2, 999], sendWindowStart: "09:00", sendWindowEnd: "20:00" });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    expect(t.reminderHours).toEqual([48, 2]);
    const conn = await prisma.whatsappConnection.findFirstOrThrow({ where: { tenantId: T.tenant.id } });
    expect(conn).toMatchObject({ sendWindowStart: "09:00", sendWindowEnd: "20:00", status: "pending" });
    await expect(saveMessageSettings(T.tenant.id, "u", { ...base, enabled: allOn(), presenceRequestHours: 3, presenceDeadlineHours: 5 })).rejects.toMatchObject({ code: "validation" });
    await expect(saveMessageSettings(T.tenant.id, "u", { ...base, enabled: allOn(), reminderHours: [] })).rejects.toMatchObject({ code: "validation" });
  });

  it("prévia preenche as variáveis do template", () => {
    const p = previewMessage("presence_request", { customer: "Maria", service: "Corte", when: "sex., 15/11, 14:00", business: "Barbearia" });
    expect(p.body).toContain("Maria");
    expect(p.body).toContain("Barbearia");
    expect(p.body).not.toContain("{{");
    expect(p.buttons).toEqual(["Confirmo presença", "Preciso remarcar"]);
  });
});

describe("clientes: cadastro e troca de telefone", () => {
  it("cadastro avulso não duplica telefone", async () => {
    const T = await makeTenant();
    const c = await createCustomer(T.tenant.id, { name: "Ana", phone: "(11) 98888-1111", email: null, notes: null, tags: ["vip"], consentWhatsapp: false }, "u");
    expect(c.phoneE164).toBe("+5511988881111");
    expect((c.consentJson as { whatsapp: boolean }).whatsapp).toBe(false);
    await expect(createCustomer(T.tenant.id, { name: "Outra", phone: "11988881111", email: null, notes: null, tags: [], consentWhatsapp: true }, "u")).rejects.toMatchObject({ code: "validation" });
    await expect(createCustomer(T.tenant.id, { name: "X", phone: "123", email: null, notes: null, tags: [], consentWhatsapp: false }, "u")).rejects.toMatchObject({ code: "validation" });
  });

  it("trocar o telefone: recusa número de outro cliente; mensagens da fila vão para o número novo", async () => {
    const T = await makeTenant();
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    await prisma.customer.update({ where: { id: r.appointment.customerId }, data: { whatsappUserId: "BR.old" } });
    await createCustomer(T.tenant.id, { name: "Bia", phone: "11977772222", email: null, notes: null, tags: [], consentWhatsapp: false }, "u");
    const data = { name: "Carla Souza", email: null, notes: null, tags: [] };

    await expect(updateCustomer(T.tenant.id, r.appointment.customerId, { ...data, phone: "11977772222" })).rejects.toMatchObject({ code: "validation" });
    await updateCustomer(T.tenant.id, r.appointment.customerId, { ...data, phone: "(21) 99999-0000" }, "u");
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.appointment.customerId } });
    expect(c).toMatchObject({ phoneE164: "+5521999990000", whatsappUserId: null });
    const pending = await prisma.messageOutbox.findMany({ where: { status: "pending" } });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((m) => m.toPhoneE164 === "+5521999990000")).toBe(true);
  });
});
