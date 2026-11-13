import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tenantDb } from "@/lib/db";
import { createBooking, markOutcome } from "@/lib/scheduling/booking";
import { anonymizeCustomer, applyRetention, exportCustomerData, importCustomersCsv, setWhatsappConsent } from "@/lib/crm";
import { buildReport, appointmentsCsv } from "@/lib/reports";
import { isEnabled, setFlag } from "@/lib/flags";
import { cancelDeletion, grantSupportAccess, purgeScheduledDeletions, scheduleDeletion, assertSupportAllowed } from "@/lib/ops";
import { requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail, beginMfaSetup, confirmMfaSetup, checkMfaCode } from "@/lib/auth/account";
import { verifyPassword } from "@/lib/auth/password";
import { totp } from "@/lib/auth/totp";
import { sentEmails } from "@/lib/email";
import { processOutbox } from "@/lib/whatsapp/outbox";
import { NOW, at, customer, makeTenant, resetDb, TZ } from "./helpers";

beforeEach(async () => {
  await resetDb();
  sentEmails.length = 0;
});

const tokenFrom = (text: string, path: string) => text.match(new RegExp(`${path}/([A-Za-z0-9_-]+)`))?.[1] ?? "";

describe("conta: senha, e-mail e MFA", () => {
  async function owner() {
    const T = await makeTenant();
    return prisma.user.create({ data: { tenantId: T.tenant.id, name: "Dona Teste", email: "dona@x.dev", passwordHash: "x", role: "owner" } });
  }

  it("redefinição: link de uso único, expira sessões; e-mail inexistente não revela nada", async () => {
    const u = await owner();
    await requestPasswordReset("ninguem@x.dev");
    expect(sentEmails).toHaveLength(0);
    await requestPasswordReset("DONA@x.dev");
    const token = tokenFrom(sentEmails[0].text, "redefinir-senha");
    expect(token.length).toBeGreaterThan(30);
    expect(JSON.stringify(await prisma.authToken.findMany())).not.toContain(token); // só o hash no banco
    await expect(resetPassword(token, "curta")).rejects.toMatchObject({ code: "validation" });
    const updated = await resetPassword(token, "nova-senha-forte-1");
    expect(await verifyPassword("nova-senha-forte-1", updated.passwordHash)).toBe(true);
    expect(updated.sessionsValidAfter).not.toBeNull();
    await expect(resetPassword(token, "outra-senha-forte")).rejects.toMatchObject({ code: "validation" }); // uso único
    expect(u.id).toBe(updated.id);
  });

  it("verificação de e-mail", async () => {
    const u = await owner();
    await sendVerificationEmail(u);
    const token = tokenFrom(sentEmails[0].text, "verificar-email");
    expect((await verifyEmail(token)).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).rejects.toThrow();
  });

  it("MFA: ativa só com código válido; segredo guardado criptografado", async () => {
    const u = await owner();
    const { secret } = await beginMfaSetup(u);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(fresh.mfaSecretEncrypted).not.toContain(secret);
    await expect(confirmMfaSetup(fresh, "000000")).rejects.toMatchObject({ code: "validation" });
    await confirmMfaSetup(fresh, totp(secret));
    const enabled = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(checkMfaCode(enabled, totp(secret))).toBe(true);
    expect(checkMfaCode(enabled, "123456")).toBe(false);
  });
});

describe("CRM e LGPD", () => {
  it("importa CSV deduplicando por telefone; consentimento só com 'sim'", async () => {
    const T = await makeTenant();
    const csv = "nome;telefone;email;etiquetas;aceita_whatsapp\nAna Lima;(11) 98888-1111;ana@x.dev;vip|gel;sim\nBia;11977772222;;;não\nAna Repetida;11988881111;;;sim\nSem Fone;123;;;\n";
    const r = await importCustomersCsv(T.tenant.id, csv, "u");
    expect(r).toMatchObject({ created: 2, skipped: 1 });
    expect(r.errors).toHaveLength(1);
    const ana = await prisma.customer.findFirstOrThrow({ where: { phoneE164: "+5511988881111" } });
    expect(ana.tags).toEqual(["vip", "gel"]);
    expect((ana.consentJson as { whatsapp: boolean }).whatsapp).toBe(true);
    const bia = await prisma.customer.findFirstOrThrow({ where: { phoneE164: "+5511977772222" } });
    expect((bia.consentJson as { whatsapp: boolean }).whatsapp).toBe(false);
    const again = await importCustomersCsv(T.tenant.id, "nome,telefone\nAna,11988881111\n", "u");
    expect(again).toMatchObject({ created: 0, updated: 1 });
  });

  it("revogar consentimento no painel cancela mensagens pendentes", async () => {
    const T = await makeTenant();
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    await setWhatsappConsent(T.tenant.id, r.appointment.customerId, false, "u");
    expect(await prisma.messageOutbox.count({ where: { status: "pending" } })).toBe(0);
    await prisma.messageOutbox.updateMany({ data: { status: "pending" } });
    await processOutbox(new Date());
    expect(await prisma.messageOutbox.count({ where: { status: "sent" } })).toBe(0); // checado também no envio
  });

  it("exporta e anonimiza: dado pessoal some, histórico fica", async () => {
    const T = await makeTenant();
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    const data = await exportCustomerData(T.tenant.id, r.appointment.customerId);
    expect(data.cliente.telefone).toBe("+5511988887777");
    expect(data.agendamentos).toHaveLength(1);
    // Agendamento futuro bloqueia a exclusão…
    await expect(anonymizeCustomer(T.tenant.id, r.appointment.customerId, "u")).rejects.toMatchObject({ code: "policy" });
    await markOutcome(T.tenant.id, r.appointment.id, "concluido", "u");
    await anonymizeCustomer(T.tenant.id, r.appointment.customerId, "u");
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.appointment.customerId } });
    expect(c).toMatchObject({ name: "Cliente removido", email: null, notes: null });
    expect(c.phoneE164.startsWith("anon:")).toBe(true);
    expect(await prisma.appointment.count()).toBe(1);
    expect(JSON.stringify(await prisma.messageOutbox.findMany())).not.toContain("988887777");
    // O mesmo telefone pode voltar a agendar como cliente novo.
    const again = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("15:00").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(again.appointment.customerId).not.toBe(r.appointment.customerId);
  });

  it("retenção: anonimiza só quem está inativo há mais que o prazo", async () => {
    const T = await makeTenant();
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { retentionMonths: 12 } });
    const db = tenantDb(T.tenant.id);
    const old = await db.customer.create({ data: { tenantId: T.tenant.id, name: "Antiga", phoneE164: "+5511900000001", createdAt: new Date("2020-01-01") } });
    const recent = await db.customer.create({ data: { tenantId: T.tenant.id, name: "Nova", phoneE164: "+5511900000002" } });
    expect(await applyRetention(new Date())).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: old.id } })).anonymizedAt).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: recent.id } })).anonymizedAt).toBeNull();
  });
});

describe("relatórios", () => {
  it("faturamento estimado, faltas, por serviço/profissional e CSV", async () => {
    const T = await makeTenant();
    const a = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: T.pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    const b = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: T.pros[1].id, startsAt: at("10:00").toISOString(), customer: customer("11955554444"), source: "manual", now: NOW });
    await markOutcome(T.tenant.id, a.appointment.id, "concluido", "u");
    await markOutcome(T.tenant.id, b.appointment.id, "nao_compareceu", "u");
    const r = await buildReport(T.tenant.id, "2030-01-01", "2030-01-31", TZ);
    expect(r).toMatchObject({ total: 2, revenueEstimatedCents: 10000, ticketCents: 10000, noShowRate: 0.5, bySource: { public: 1, manual: 1 } });
    expect(r.byProfessional.find((p) => p.name === "Bia")?.noShows).toBe(1);
    expect(r.byWeekday[1]).toBe(2); // 07/01/2030 é segunda
    const only = await buildReport(T.tenant.id, "2030-01-01", "2030-01-31", TZ, T.pros[0].id);
    expect(only.total).toBe(1);
    const csv = await appointmentsCsv(T.tenant.id, "2030-01-01", "2030-01-31", TZ);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("100,00");
  });
});

describe("flags e operação", () => {
  it("flag global com exceção por empresa", async () => {
    const T = await makeTenant();
    expect(await isEnabled("waitlist", T.tenant.id)).toBe(true);
    await setFlag("waitlist", false, "global");
    expect(await isEnabled("waitlist", T.tenant.id)).toBe(false);
    await setFlag("waitlist", true, T.tenant.id);
    expect(await isEnabled("waitlist", T.tenant.id)).toBe(true);
    await setFlag("waitlist", null, "global");
    await setFlag("coupons", false, T.tenant.id);
    await prisma.coupon.create({ data: { tenantId: T.tenant.id, code: "X10", discountType: "percent", discountValue: 10 } });
    await expect(
      createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: customer(), couponCode: "X10", source: "public", now: NOW }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("acesso de suporte só com autorização do dono", async () => {
    const T = await makeTenant();
    await expect(assertSupportAllowed(T.tenant.id)).rejects.toMatchObject({ code: "policy" });
    await grantSupportAccess(T.tenant.id, 2, "dono");
    await expect(assertSupportAllowed(T.tenant.id)).resolves.toBeTruthy();
    await expect(grantSupportAccess(T.tenant.id, 999, "dono")).rejects.toMatchObject({ code: "validation" });
  });

  it("exclusão programada: suspende, pode cancelar, e apaga tudo no prazo", async () => {
    const T = await makeTenant();
    await scheduleDeletion(T.tenant.id, "admin");
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).toMatchObject({ status: "suspended", suspendedReason: "deletion" });
    await cancelDeletion(T.tenant.id, "admin");
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).toMatchObject({ status: "active", deletionScheduledAt: null });
    await scheduleDeletion(T.tenant.id, "admin", 0);
    expect(await purgeScheduledDeletions(new Date(Date.now() + 1000))).toBe(1);
    expect(await prisma.tenant.findUnique({ where: { id: T.tenant.id } })).toBeNull();
    expect(await prisma.service.count()).toBe(0);
  });
});
