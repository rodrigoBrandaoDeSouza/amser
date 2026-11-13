import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tenantDb } from "@/lib/db";
import { createBooking, getAvailability, rescheduleAppointment, cancelAppointment, markOutcome } from "@/lib/scheduling/booking";
import { handlePaymentWebhook } from "@/lib/payments/service";
import { signMockWebhook, MOCK_SIGNATURE_HEADER } from "@/lib/payments/provider";
import { expireHolds } from "@/lib/jobs";
import { processOutbox } from "@/lib/whatsapp/outbox";
import { mockSent, mockWhatsappFailNext } from "@/lib/whatsapp/provider";
import { noShowMetrics } from "@/lib/metrics";
import { NOW, at, customer, makeTenant, resetDb, TZ, DAY } from "./helpers";

beforeEach(resetDb);

function webhook(body: object) {
  const { raw, signature } = signMockWebhook(body);
  return handlePaymentWebhook("mock", raw, new Headers({ [MOCK_SIGNATURE_HEADER]: signature }));
}

describe("concorrência", () => {
  it("duas reservas simultâneas não ocupam o mesmo horário/profissional", async () => {
    const { tenant, pros, service } = await makeTenant();
    const input = { tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), source: "public" as const, now: NOW };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => createBooking({ ...input, customer: customer(`1198888${String(7000 + i)}`) })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const active = await prisma.appointment.count({ where: { professionalId: pros[0].id, status: { in: ["pendente", "confirmado", "aguardando_sinal"] } } });
    expect(active).toBe(1);
  });

  it("'qualquer profissional' distribui reservas simultâneas entre os disponíveis", async () => {
    const { tenant, service } = await makeTenant();
    const input = { tenant, serviceId: service.id, professionalId: null, startsAt: at("10:00").toISOString(), source: "public" as const, now: NOW };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => createBooking({ ...input, customer: customer(`1197777${String(7000 + i)}`) })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2); // 2 profissionais
  });

  it("buffer de preparação bloqueia o horário seguinte", async () => {
    const { tenant, pros, service } = await makeTenant();
    await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    const slots = await getAvailability({ tenant, serviceId: service.id, professionalId: pros[0].id, date: DAY, now: NOW });
    const times = slots.map((s) => s.startsAt);
    expect(times).not.toContain(at("11:00").toISOString()); // 10:00–11:00 + 10min buffer
    expect(times).toContain(at("11:15").toISOString());
  });
});

describe("sinal via Pix", () => {
  it("reserva provisória → Pix pago confirma uma única vez (webhook duplicado)", async () => {
    const { tenant, pros, service } = await makeTenant({ deposit: { type: "percent", value: 30 } });
    const r = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(r.appointment.status).toBe("aguardando_sinal");
    expect(r.payment?.amountCents).toBe(3000);
    const pay = await prisma.payment.findFirstOrThrow({ where: { appointmentId: r.appointment.id } });

    const body = { id: "evt_1", chargeId: pay.providerChargeId, status: "paid" };
    expect(await webhook(body)).toEqual({ ok: true, outcome: "confirmed" });
    expect(await webhook(body)).toEqual({ ok: true, outcome: "duplicate" });
    expect(await webhook({ ...body, id: "evt_2" })).toEqual({ ok: true, outcome: "duplicate" });

    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } });
    expect(appt.status).toBe("confirmado");
    const events = await prisma.appointmentEvent.count({ where: { appointmentId: appt.id, eventType: "deposit_paid" } });
    expect(events).toBe(1);
  });

  it("assinatura inválida é rejeitada", async () => {
    const res = await handlePaymentWebhook("mock", JSON.stringify({ id: "x", chargeId: "y", status: "paid" }), new Headers({ [MOCK_SIGNATURE_HEADER]: "bad" }));
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("Pix não pago no prazo libera o horário; pagamento tardio não ressuscita", async () => {
    const { tenant, pros, service } = await makeTenant({ deposit: { type: "fixed", value: 2000 } });
    const r = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    const later = new Date(NOW.getTime() + 16 * 60_000);

    // Antes do job: outro cliente consegue reservar (reserva vencida é expirada na transação).
    const other = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer("11966665555"), source: "public", now: later });
    expect(other.appointment.id).not.toBe(r.appointment.id);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe("expirado");

    const pay = await prisma.payment.findFirstOrThrow({ where: { appointmentId: r.appointment.id } });
    expect(await webhook({ id: "evt_late", chargeId: pay.providerChargeId, status: "paid" })).toEqual({ ok: true, outcome: "late_payment" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).needsRefund).toBe(true);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe("expirado");
  });

  it("job de expiração libera reservas vencidas", async () => {
    const { tenant, pros, service } = await makeTenant({ deposit: { type: "percent", value: 50 } });
    await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(await expireHolds(new Date(NOW.getTime() + 20 * 60_000))).toBe(1);
  });

  it("cancelamento fora do prazo retém o sinal; falta também", async () => {
    const { tenant, pros, service } = await makeTenant({ deposit: { type: "percent", value: 30 } });
    const r = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    const pay = await prisma.payment.findFirstOrThrow({ where: { appointmentId: r.appointment.id } });
    await webhook({ id: "e1", chargeId: pay.providerChargeId, status: "paid" });
    const res = await cancelAppointment(tenant.id, r.appointment.id, { kind: "customer" }, undefined, NOW); // 4h antes; limite 24h
    expect(res.depositRetained).toBe(true);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("retained");

    const r2 = await createBooking({ tenant, serviceId: service.id, professionalId: pros[1].id, startsAt: at("11:00").toISOString(), customer: customer("11955554444"), source: "public", now: NOW });
    const pay2 = await prisma.payment.findFirstOrThrow({ where: { appointmentId: r2.appointment.id } });
    await webhook({ id: "e2", chargeId: pay2.providerChargeId, status: "paid" });
    await markOutcome(tenant.id, r2.appointment.id, "nao_compareceu", "staff");
    const m = await noShowMetrics(tenant.id, "2030-01", TZ);
    expect(m.noShows).toBe(1);
    expect(m.retainedDepositsCents).toBe(6000);
  });
});

describe("remarcação atômica", () => {
  it("só libera o horário antigo se o novo for reservado", async () => {
    const { tenant, pros, service } = await makeTenant();
    const a = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00", "2030-01-09").toISOString(), customer: customer(), source: "public", now: NOW });
    await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("14:00", "2030-01-09").toISOString(), customer: customer("11944443333"), source: "public", now: NOW });

    await expect(
      rescheduleAppointment(tenant.id, a.appointment.id, at("14:00", "2030-01-09").toISOString(), { kind: "customer" }, { now: NOW }),
    ).rejects.toMatchObject({ code: "slot_unavailable" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.appointment.id } })).startsAt.toISOString()).toBe(at("10:00", "2030-01-09").toISOString());

    await rescheduleAppointment(tenant.id, a.appointment.id, at("16:00", "2030-01-09").toISOString(), { kind: "customer" }, { now: NOW });
    const slots = await getAvailability({ tenant, serviceId: service.id, professionalId: pros[0].id, date: "2030-01-09", now: NOW });
    expect(slots.map((s) => s.startsAt)).toContain(at("10:00", "2030-01-09").toISOString());
  });
});

describe("isolamento entre tenants", () => {
  it("tenantDb nunca enxerga dados de outro tenant", async () => {
    const A = await makeTenant();
    const B = await makeTenant();
    const r = await createBooking({ tenant: A.tenant, serviceId: A.service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });

    const dbB = tenantDb(B.tenant.id);
    expect(await dbB.appointment.findFirst({ where: { id: r.appointment.id } })).toBeNull();
    expect(await dbB.customer.count()).toBe(0);
    expect(await dbB.service.findMany()).toHaveLength(1);
    const upd = await dbB.appointment.updateMany({ where: { id: r.appointment.id }, data: { status: "cancelado" } });
    expect(upd.count).toBe(0);
    await expect(dbB.appointment.update({ where: { id: r.appointment.id }, data: { status: "cancelado" } })).rejects.toThrow();
    // Serviço de A não pode ser reservado "pelo" tenant B.
    await expect(
      createBooking({ tenant: B.tenant, serviceId: A.service.id, professionalId: null, startsAt: at("11:00").toISOString(), customer: customer(), source: "public", now: NOW }),
    ).rejects.toMatchObject({ code: "not_found" });
    // Cancelar agendamento de A usando o tenant B falha.
    await expect(cancelAppointment(B.tenant.id, r.appointment.id, { kind: "staff", userId: "x" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("mesmo telefone vira clientes distintos por tenant (deduplicação só dentro do tenant)", async () => {
    const A = await makeTenant();
    const B = await makeTenant();
    for (const T of [A, B]) {
      await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
      await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("12:00").toISOString(), customer: customer(), source: "public", now: NOW });
    }
    expect(await prisma.customer.count()).toBe(2);
  });
});

describe("WhatsApp", () => {
  it("falha no provedor não afeta o agendamento; retenta com backoff e entrega", async () => {
    const { tenant, pros, service } = await makeTenant();
    const r = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    const msgs = await prisma.messageOutbox.findMany({ where: { appointmentId: r.appointment.id } });
    expect(msgs.map((m) => m.eventType).sort()).toEqual(["booking_confirmed", "presence_request", "reminder"]);

    mockWhatsappFailNext(1);
    const t0 = new Date();
    const s1 = await processOutbox(t0);
    expect(s1.failed).toBe(1);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe("pendente");

    const before = mockSent.length;
    await processOutbox(new Date(t0.getTime() + 5 * 60_000));
    expect(mockSent.length).toBe(before + 1);
    const confirmed = await prisma.messageOutbox.findFirstOrThrow({ where: { appointmentId: r.appointment.id, eventType: "booking_confirmed" } });
    expect(confirmed.status).toBe("sent");
    expect(confirmed.attempts).toBe(2);
  });

  it("lembrete de horário remarcado é descartado e um novo é criado", async () => {
    const { tenant, pros, service } = await makeTenant();
    const r = await createBooking({ tenant, serviceId: service.id, professionalId: pros[0].id, startsAt: at("10:00", "2030-01-10").toISOString(), customer: customer(), source: "public", now: NOW });
    await rescheduleAppointment(tenant.id, r.appointment.id, at("15:00", "2030-01-10").toISOString(), { kind: "staff", userId: "u" }, { now: NOW });
    await processOutbox(at("09:00", "2030-01-10"));
    const old = await prisma.messageOutbox.findFirstOrThrow({ where: { appointmentId: r.appointment.id, eventType: "reminder", payloadJson: { path: ["startsAt"], equals: at("10:00", "2030-01-10").toISOString() } } });
    expect(old.status).toBe("skipped");
    const fresh = await prisma.messageOutbox.count({ where: { appointmentId: r.appointment.id, eventType: "reminder", status: "pending" } });
    expect(fresh).toBe(1);
  });

  it("sem consentimento, nenhuma mensagem é enfileirada", async () => {
    const { tenant, service } = await makeTenant();
    await createBooking({ tenant, serviceId: service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: { ...customer(), consentWhatsapp: false }, source: "public", now: NOW });
    expect(await prisma.messageOutbox.count()).toBe(0);
  });
});
