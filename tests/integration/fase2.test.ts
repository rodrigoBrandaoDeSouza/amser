import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@prisma/client";
import { prisma, tenantDb } from "@/lib/db";
import { createBooking, cancelAppointment, getAvailability, markOutcome } from "@/lib/scheduling/booking";
import { creditBalance, computeSettlement } from "@/lib/scheduling/deposit-policy";
import { handlePaymentWebhook } from "@/lib/payments/service";
import { signMockWebhook, MOCK_SIGNATURE_HEADER, mockRefundFailNext } from "@/lib/payments/provider";
import { expireHolds, retryRefunds } from "@/lib/jobs";
import { joinWaitlist, bookFromWaitlist, signWaitlistToken, offerFreedSlot } from "@/lib/waitlist";
import { addMonths, handleBillingWebhook, runBillingCycle, startTrial } from "@/lib/billing/service";
import { signMockBillingWebhook, BILLING_SIGNATURE_HEADER } from "@/lib/billing/provider";
import { addDomain, canIssueCertificate, normalizeHostname, tenantByHost, verifyDomain } from "@/lib/domains";
import { connectInstagram, importInstagramMedia, listInstagramMedia } from "@/lib/instagram/service";
import { isAllowedMediaHost } from "@/lib/instagram/provider";
import { selfSignup } from "@/lib/tenants";
import { assertWithinPlan } from "@/lib/plans";
import { zonedToUtc } from "@/lib/time";
import { NOW, at, customer, makeTenant, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  process.env.INSTAGRAM_PROVIDER = "mock";
});

async function pay(appointmentId: string, id = `evt_${Math.random()}`) {
  const p = await prisma.payment.findFirstOrThrow({ where: { appointmentId, status: "pending" } });
  const { raw, signature } = signMockWebhook({ id, chargeId: p.providerChargeId, status: "paid" });
  return handlePaymentWebhook("mock", raw, new Headers({ [MOCK_SIGNATURE_HEADER]: signature }));
}

type Fixture = { tenant: Tenant; service: { id: string }; pros: { id: string }[] };
const book = (T: Fixture, hhmm: string, extra: Partial<Parameters<typeof createBooking>[0]> = {}) =>
  createBooking({
    tenant: T.tenant,
    serviceId: T.service.id,
    professionalId: T.pros[0].id,
    startsAt: at(hhmm, "2030-01-09").toISOString(),
    customer: customer(),
    source: "public",
    now: NOW,
    ...extra,
  });

describe("cupons", () => {
  it("desconto aplicado e sinal calculado sobre o preço com desconto", async () => {
    const T = await makeTenant({ deposit: { type: "percent", value: 30 } });
    await prisma.coupon.create({ data: { tenantId: T.tenant.id, code: "VERAO20", discountType: "percent", discountValue: 20 } });
    const r = await book(T, "10:00", { couponCode: "verao20" });
    expect(r.discountCents).toBe(2000);
    expect(r.appointment.priceSnapshotCents).toBe(8000);
    expect(r.payment?.amountCents).toBe(2400); // 30% de 80,00
  });

  it("limite de usos respeitado sob concorrência; Pix expirado devolve o uso", async () => {
    const T = await makeTenant({ deposit: { type: "fixed", value: 1000 } });
    await prisma.coupon.create({ data: { tenantId: T.tenant.id, code: "UNICO", discountType: "fixed", discountValue: 500, maxRedemptions: 1, maxPerCustomer: 5 } });
    const results = await Promise.allSettled([
      book(T, "10:00", { couponCode: "UNICO", customer: customer("11911110001") }),
      book(T, "14:00", { couponCode: "UNICO", customer: customer("11911110002"), professionalId: T.pros[1].id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.coupon.findFirstOrThrow({})).redemptionsCount).toBe(1);
    await expireHolds(new Date(NOW.getTime() + 20 * 60_000));
    expect((await prisma.coupon.findFirstOrThrow({})).redemptionsCount).toBe(0);
  });

  it("cupom de outro tenant não vale", async () => {
    const A = await makeTenant();
    const B = await makeTenant();
    await prisma.coupon.create({ data: { tenantId: A.tenant.id, code: "SOA", discountType: "percent", discountValue: 50 } });
    await expect(book(B, "10:00", { couponCode: "SOA" })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("política de sinal", () => {
  it("cálculo: crédito usado volta primeiro; retenção parcial", () => {
    expect(computeSettlement({ pixPaidCents: 3000, creditAppliedCents: 0, retainPercent: 50, mode: "refund" })).toEqual({ retainCents: 1500, creditBackCents: 0, refundCents: 1500 });
    expect(computeSettlement({ pixPaidCents: 1000, creditAppliedCents: 2000, retainPercent: 0, mode: "refund" })).toEqual({ retainCents: 0, creditBackCents: 2000, refundCents: 1000 });
    expect(computeSettlement({ pixPaidCents: 3000, creditAppliedCents: 0, retainPercent: 0, mode: "credit" })).toEqual({ retainCents: 0, creditBackCents: 3000, refundCents: 0 });
  });

  it("modo crédito: cancelou no prazo → crédito → próximo agendamento confirma sem Pix", async () => {
    const T = await makeTenant({ deposit: { type: "fixed", value: 3000 } });
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { depositRefundMode: "credit" } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    const a = await book({ ...T, tenant }, "10:00");
    await pay(a.appointment.id);
    const res = await cancelAppointment(tenant.id, a.appointment.id, { kind: "customer" }, undefined, NOW);
    expect(res.creditedCents).toBe(3000);
    expect(await creditBalance(prisma, tenant.id, a.appointment.customerId)).toBe(3000);

    const b = await book({ ...T, tenant }, "15:00");
    expect(b.creditAppliedCents).toBe(3000);
    expect(b.payment).toBeNull();
    expect(b.appointment.status).toBe("confirmado");
    expect(await creditBalance(prisma, tenant.id, a.appointment.customerId)).toBe(0);
  });

  it("crédito parcial + Pix; Pix expirado devolve o crédito", async () => {
    const T = await makeTenant({ deposit: { type: "fixed", value: 3000 } });
    const c = await tenantDb(T.tenant.id).customer.create({ data: { tenantId: T.tenant.id, name: "Carla", phoneE164: "+5511988887777", consentJson: {} } });
    await prisma.customerCredit.create({ data: { tenantId: T.tenant.id, customerId: c.id, amountCents: 1000, reason: "teste" } });
    const r = await book(T, "10:00");
    expect(r.creditAppliedCents).toBe(1000);
    expect(r.payment?.amountCents).toBe(2000);
    await expireHolds(new Date(NOW.getTime() + 20 * 60_000));
    expect(await creditBalance(prisma, T.tenant.id, c.id)).toBe(1000);
  });

  it("modo reembolso: automático no PSP; falha fica pendente e o job tenta de novo", async () => {
    const T = await makeTenant({ deposit: { type: "fixed", value: 3000 } });
    const a = await book(T, "10:00");
    await pay(a.appointment.id);
    mockRefundFailNext(1);
    const res = await cancelAppointment(T.tenant.id, a.appointment.id, { kind: "customer" }, undefined, NOW);
    expect(res.refundCents).toBe(3000);
    let p = await prisma.payment.findFirstOrThrow({ where: { appointmentId: a.appointment.id } });
    expect(p.needsRefund).toBe(true);
    expect(await retryRefunds()).toBe(1);
    p = await prisma.payment.findFirstOrThrow({ where: { appointmentId: a.appointment.id } });
    expect(p).toMatchObject({ needsRefund: false, status: "refunded", refundedCents: 3000 });
  });

  it("cancelamento tardio retém só o percentual configurado; falta idem", async () => {
    const T = await makeTenant({ deposit: { type: "fixed", value: 4000 } });
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { lateCancelRetainPercent: 50, noShowRetainPercent: 75 } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    const a = await book({ ...T, tenant }, "10:00");
    await pay(a.appointment.id);
    const lateNow = new Date(at("10:00", "2030-01-09").getTime() - 3 * 3600_000);
    const res = await cancelAppointment(tenant.id, a.appointment.id, { kind: "customer" }, undefined, lateNow);
    expect(res).toMatchObject({ retainedCents: 2000, refundCents: 2000 });
    const p = await prisma.payment.findFirstOrThrow({ where: { appointmentId: a.appointment.id } });
    expect(p).toMatchObject({ status: "retained", retainedCents: 2000, refundedCents: 2000 });

    const b = await book({ ...T, tenant }, "15:00", { customer: customer("11922223333") });
    await pay(b.appointment.id);
    await markOutcome(tenant.id, b.appointment.id, "nao_compareceu", "u");
    const p2 = await prisma.payment.findFirstOrThrow({ where: { appointmentId: b.appointment.id } });
    expect(p2.retainedCents).toBe(3000);
  });
});

describe("lista de espera", () => {
  it("cancelamento oferece o horário; quem reservar pelo link fica com ele", async () => {
    const T = await makeTenant();
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { maxHorizonDays: 3650 } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    // Lota o dia dos dois profissionais.
    // Serviço de 60 min + 10 de preparo, grade de 15 min, jornada 09–18.
    const booked = [];
    let n = 0;
    for (const pro of T.pros) {
      for (const h of ["09:00", "10:15", "11:30", "12:45", "14:00", "15:15", "16:30"]) {
        booked.push(await book({ ...T, tenant }, h, { professionalId: pro.id, customer: customer(`119300000${String(n++).padStart(2, "0")}`) }));
      }
    }
    expect(await getAvailability({ tenant, serviceId: T.service.id, professionalId: null, date: "2030-01-09" })).toEqual([]);

    const entry = await joinWaitlist({ tenant, serviceId: T.service.id, professionalId: null, date: "2030-01-09", customer: { ...customer("11955550000"), name: "Bruna Lista" } });
    await cancelAppointment(tenant.id, booked[3].appointment.id, { kind: "staff", userId: "u" });

    const offer = await prisma.messageOutbox.findFirst({ where: { eventType: "waitlist_offer" } });
    expect(offer?.toPhoneE164).toBe("+5511955550000");
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("offered");

    const token = await signWaitlistToken(entry.id, tenant.id, new Date(Date.now() + 86400_000));
    const r = await bookFromWaitlist(token, booked[3].appointment.startsAt.toISOString());
    expect(r.appointment.status).toBe("pendente");
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("booked");
    await expect(bookFromWaitlist(token, booked[3].appointment.startsAt.toISOString())).rejects.toMatchObject({ code: "policy" });
  });

  it("limite de 3 listas por cliente e exige consentimento", async () => {
    const T = await makeTenant();
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { maxHorizonDays: 3650 } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    for (const d of ["2030-01-08", "2030-01-09", "2030-01-10"]) {
      await joinWaitlist({ tenant, serviceId: T.service.id, professionalId: null, date: d, customer: customer() });
    }
    await expect(joinWaitlist({ tenant, serviceId: T.service.id, professionalId: null, date: "2030-01-11", customer: customer() })).rejects.toMatchObject({ code: "policy" });
    await expect(
      joinWaitlist({ tenant, serviceId: T.service.id, professionalId: null, date: "2030-01-11", customer: { ...customer("11977776666"), consentWhatsapp: false } }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("não oferta para quem está em outra data", async () => {
    const T = await makeTenant();
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { maxHorizonDays: 3650 } });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } });
    await joinWaitlist({ tenant, serviceId: T.service.id, professionalId: null, date: "2030-01-10", customer: customer() });
    expect(await offerFreedSlot(tenant.id, T.pros[0].id, at("10:00", "2030-01-09"))).toBe(0);
  });
});

describe("múltiplas unidades", () => {
  it("filtra profissionais por unidade e usa o fuso da unidade", async () => {
    const T = await makeTenant();
    const manaus = await prisma.unit.create({ data: { tenantId: T.tenant.id, name: "Manaus", timezone: "America/Manaus" } });
    await prisma.professional.update({ where: { id: T.pros[1].id }, data: { unitId: manaus.id } });
    const slots = await getAvailability({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, unitId: manaus.id, date: "2030-01-09", now: NOW });
    expect(slots.every((s) => s.professionalIds.join() === T.pros[1].id)).toBe(true);
    // 09:00 em Manaus = 13:00 UTC (UTC-4)
    expect(slots[0].startsAt).toBe(zonedToUtc("2030-01-09", "09:00", "America/Manaus").toISOString());
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, unitId: manaus.id, startsAt: slots[0].startsAt, customer: customer(), source: "public", now: NOW });
    expect(r.appointment.unitId).toBe(manaus.id);
  });

  it("limites do plano", async () => {
    const T = await makeTenant();
    const plan = await prisma.plan.create({ data: { name: "Solo", priceCents: 4990, limitsJson: { professionals: 2, units: 1 } } });
    const tenant = await prisma.tenant.update({ where: { id: T.tenant.id }, data: { planId: plan.id } });
    await expect(assertWithinPlan(tenant, "professionals")).rejects.toMatchObject({ code: "policy" });
    await expect(assertWithinPlan(tenant, "units")).rejects.toMatchObject({ code: "policy" });
  });
});

describe("assinatura do SaaS", () => {
  it("trial → fatura → inadimplência → suspensão → pagamento reativa", async () => {
    const T = await makeTenant();
    const plan = await prisma.plan.create({ data: { name: "Essencial", priceCents: 5990 } });
    const t0 = new Date("2030-01-01T12:00:00Z");
    const sub = await startTrial(prisma, T.tenant.id, plan.id, t0);
    const trialEnd = sub.periodEnd;

    await runBillingCycle(new Date(trialEnd.getTime() - 3 * 86400_000));
    const inv = await prisma.billingInvoice.findFirstOrThrow({ where: { subscriptionId: sub.id } });
    expect(inv).toMatchObject({ amountCents: 5990, status: "open" });
    await runBillingCycle(new Date(trialEnd.getTime() - 2 * 86400_000));
    expect(await prisma.billingInvoice.count()).toBe(1); // idempotente

    await runBillingCycle(new Date(trialEnd.getTime() + 3600_000));
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("past_due");
    await runBillingCycle(new Date(trialEnd.getTime() + 6 * 86400_000));
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).toMatchObject({ status: "suspended", suspendedReason: "billing", statusBeforeSuspension: "active" });

    const { raw, signature } = signMockBillingWebhook({ id: "evt_b1", chargeId: inv.providerChargeId, status: "paid" });
    const h = new Headers({ [BILLING_SIGNATURE_HEADER]: signature });
    expect(await handleBillingWebhook("billing-mock", raw, h)).toEqual({ ok: true, outcome: "paid" });
    expect(await handleBillingWebhook("billing-mock", raw, h)).toEqual({ ok: true, outcome: "duplicate" });
    expect(await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).toMatchObject({ status: "active", suspendedReason: null });
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(s.status).toBe("active");
    expect(s.periodEnd.toISOString()).toBe(addMonths(trialEnd, 1).toISOString());
  });

  it("suspensão pelo admin não é revertida por pagamento", async () => {
    const T = await makeTenant();
    const plan = await prisma.plan.create({ data: { name: "Essencial", priceCents: 5990 } });
    const sub = await startTrial(prisma, T.tenant.id, plan.id, new Date("2030-01-01T12:00:00Z"));
    await runBillingCycle(new Date(sub.periodEnd.getTime() - 86400_000));
    await prisma.tenant.update({ where: { id: T.tenant.id }, data: { status: "suspended", suspendedReason: "admin" } });
    const inv = await prisma.billingInvoice.findFirstOrThrow({});
    const { raw, signature } = signMockBillingWebhook({ id: "evt_b2", chargeId: inv.providerChargeId, status: "paid" });
    await handleBillingWebhook("billing-mock", raw, new Headers({ [BILLING_SIGNATURE_HEADER]: signature }));
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("suspended");
  });

  it("addMonths não pula mês", () => {
    expect(addMonths(new Date("2030-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2030-02-28");
  });
});

describe("domínio próprio", () => {
  it("valida, verifica por TXT e resolve só domínio verificado de empresa ativa", async () => {
    const T = await makeTenant();
    expect(() => normalizeHostname("localhost")).toThrow();
    expect(() => normalizeHostname("app.up.railway.app")).toThrow();
    expect(normalizeHostname("https://Agenda.Studio.com.br/x")).toBe("agenda.studio.com.br");

    const d = await addDomain(T.tenant.id, "agenda.studio.com.br");
    expect(await tenantByHost("agenda.studio.com.br")).toBeNull();
    expect(await canIssueCertificate("agenda.studio.com.br")).toBe(false); // HTTPS só depois de verificado
    await expect(verifyDomain(T.tenant.id, d.id, async () => [["outro-valor"]])).rejects.toMatchObject({ code: "validation" });
    await verifyDomain(T.tenant.id, d.id, async (name) => {
      expect(name).toBe("_amser-verify.agenda.studio.com.br");
      return [[d.verificationToken]];
    });
    expect((await tenantByHost("AGENDA.studio.com.br:443"))?.id).toBe(T.tenant.id);
    expect(await canIssueCertificate("agenda.studio.com.br")).toBe(true);
    expect(await canIssueCertificate("qualquer.dominio.com")).toBe(false);
    expect(await canIssueCertificate("1.2.3.4")).toBe(false);

    const other = await makeTenant();
    await expect(addDomain(other.tenant.id, "agenda.studio.com.br")).rejects.toMatchObject({ code: "validation" });
    await expect(verifyDomain(other.tenant.id, d.id, async () => [[d.verificationToken]])).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Instagram (provider mock)", () => {
  it("conecta, lista e importa só imagens; vídeo é recusado", async () => {
    const T = await makeTenant();
    await connectInstagram(T.tenant.id, "user-1", "mock-code");
    const conn = await prisma.instagramConnection.findFirstOrThrow({});
    expect(conn.encryptedToken).not.toContain("mock-ig-token");
    const list = await listInstagramMedia(T.tenant.id);
    expect(list.username).toBe("studio_demo");
    const video = list.items.find((m) => m.type === "VIDEO")!;
    const images = list.items.filter((m) => m.type === "IMAGE").slice(0, 2);
    const r = await importInstagramMedia(T.tenant.id, "user-1", [...images.map((m) => m.id), video.id]);
    expect(r).toEqual({ imported: 2, failed: 1 });
    const media = await prisma.tenantMedia.findMany({ where: { tenantId: T.tenant.id } });
    expect(media.every((m) => m.rightsConfirmed && m.rightsConfirmedBy === "instagram:studio_demo")).toBe(true);
  });

  it("só baixa de CDNs da Meta (anti-SSRF)", () => {
    expect(isAllowedMediaHost("https://scontent.cdninstagram.com/x.jpg")).toBe(true);
    expect(isAllowedMediaHost("https://x.fbcdn.net/a.jpg")).toBe(true);
    expect(isAllowedMediaHost("http://scontent.cdninstagram.com/x.jpg")).toBe(false);
    expect(isAllowedMediaHost("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedMediaHost("https://evil.com/cdninstagram.com")).toBe(false);
  });
});

describe("cadastro self-service", () => {
  it("cria empresa em onboarding, dono e trial; e-mail duplicado é recusado", async () => {
    await prisma.plan.create({ data: { name: "Essencial", priceCents: 5990 } });
    const { tenant, user } = await selfSignup({ businessName: "Nails da Lu", segment: "nail", ownerName: "Lu", email: "LU@x.dev", password: "senha-forte-123" });
    expect(tenant.status).toBe("onboarding");
    expect(user.email).toBe("lu@x.dev");
    expect(await prisma.subscription.findFirst({ where: { tenantId: tenant.id, status: "trialing" } })).toBeTruthy();
    await expect(selfSignup({ businessName: "Outra", segment: "nail", ownerName: "X", email: "lu@x.dev", password: "senha-forte-123" })).rejects.toMatchObject({ code: "validation" });
    expect(await prisma.tenant.count()).toBe(1);
  });
});
