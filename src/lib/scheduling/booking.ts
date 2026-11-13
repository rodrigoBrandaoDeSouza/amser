import type { Appointment, AppointmentStatus, Prisma, Tenant } from "@prisma/client";
import { prisma, isOverlapViolation, isTransientTxError, withTxRetry, BOOKING_TX, tenantDb } from "../db";
import { Errors, AppError } from "../errors";
import { addMinutes, localDate, isValidDate, weekdayOf } from "../time";
import { computeSlots, dayBounds, type Interval } from "./availability";
import { computeDepositCents, isWithinCancelWindow } from "./deposit";
import { applySettlement, computeSettlement, creditBalance, processRefundSafe } from "./deposit-policy";
import { paymentProvider } from "../payments/provider";
import { decryptJson } from "../crypto";
import { scheduleAppointmentMessagesSafe } from "../whatsapp/outbox";
import { actionTokenExpiry, signActionToken } from "../tokens";
import { upsertCustomer, parseCustomer, type CustomerInput } from "../customers";
import { quoteCoupon, redeemCoupon, releaseCoupon } from "../coupons";

export const ACTIVE_STATUSES: AppointmentStatus[] = ["aguardando_sinal", "pendente", "confirmado"];

export interface SlotOption {
  startsAt: string; // ISO UTC
  professionalIds: string[];
}

type Tx = Prisma.TransactionClient;

/**
 * Libera efeitos colaterais de reservas que expiraram sem pagamento:
 * devolve crédito usado e o uso do cupom. Chamado na mesma transação.
 */
export async function releaseExpiredSideEffects(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.payment.updateMany({ where: { appointmentId: { in: ids }, status: "pending" }, data: { status: "expired" } });
  const appts = await tx.appointment.findMany({
    where: { id: { in: ids } },
    select: { id: true, tenantId: true, customerId: true, creditAppliedCents: true, couponId: true },
  });
  for (const a of appts) {
    if (a.creditAppliedCents > 0) {
      await tx.customerCredit.create({
        data: { tenantId: a.tenantId, customerId: a.customerId, appointmentId: a.id, amountCents: a.creditAppliedCents, reason: "reserva expirada" },
      });
    }
    if (a.couponId) await releaseCoupon(tx, a.couponId);
  }
}

/** Expira reservas provisórias vencidas de um profissional (dentro da transação). */
async function expireStaleHolds(tx: Tx, professionalId: string, now: Date) {
  const stale = await tx.appointment.findMany({
    where: { professionalId, status: "aguardando_sinal", holdExpiresAt: { lt: now } },
    select: { id: true },
  });
  if (!stale.length) return;
  const ids = stale.map((s) => s.id);
  await tx.appointment.updateMany({ where: { id: { in: ids }, status: "aguardando_sinal" }, data: { status: "expirado" } });
  await releaseExpiredSideEffects(tx, ids);
}

/** Oferece um horário liberado para a lista de espera (sem acoplar os módulos). */
export async function notifyFreedSlot(tenantId: string, professionalId: string, startsAt: Date) {
  try {
    const { offerFreedSlot } = await import("../waitlist");
    await offerFreedSlot(tenantId, professionalId, startsAt);
  } catch (err) {
    console.error("[lista de espera] falha ao ofertar", err instanceof Error ? err.message : err);
  }
}

/**
 * Disponibilidade de um serviço em uma data (§7). Se professionalId for null,
 * considera qualquer profissional habilitado (opcionalmente só de uma unidade).
 */
export async function getAvailability(params: {
  tenant: Tenant;
  serviceId: string;
  professionalId: string | null;
  unitId?: string | null;
  date: string;
  now?: Date;
  excludeAppointmentId?: string;
  ignoreAdvance?: boolean;
}): Promise<SlotOption[]> {
  const { tenant, serviceId, date } = params;
  const now = params.now ?? new Date();
  if (!isValidDate(date)) throw Errors.validation("Data inválida");
  const db = tenantDb(tenant.id);

  const service = await db.service.findFirst({
    where: { id: serviceId, active: true },
    include: { professionals: { include: { professional: { include: { unit: true } } } } },
  });
  if (!service) throw Errors.notFound("Serviço");

  let pros = service.professionals.map((sp) => sp.professional).filter((p) => p.active && p.unit.active);
  if (params.professionalId) pros = pros.filter((p) => p.id === params.professionalId);
  if (params.unitId) pros = pros.filter((p) => p.unitId === params.unitId);
  if (!pros.length) return [];

  const weekday = weekdayOf(date);
  const result = new Map<number, string[]>();

  for (const pro of pros) {
    const tz = pro.unit.timezone;
    const bounds = dayBounds(date, tz);
    const [hours, exceptions, appts] = await Promise.all([
      db.workingHour.findMany({ where: { professionalId: pro.id, weekday } }),
      db.scheduleException.findMany({
        where: { OR: [{ professionalId: pro.id }, { professionalId: null }], startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
      }),
      db.appointment.findMany({
        where: {
          professionalId: pro.id,
          status: { in: ACTIVE_STATUSES },
          startsAt: { lt: bounds.end },
          blockEndsAt: { gt: bounds.start },
          ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
        },
        select: { startsAt: true, blockEndsAt: true, status: true, holdExpiresAt: true },
      }),
    ]);
    const busy: Interval[] = [
      ...exceptions.map((e) => ({ start: e.startsAt, end: e.endsAt })),
      ...appts
        .filter((a) => a.status !== "aguardando_sinal" || (a.holdExpiresAt && a.holdExpiresAt > now))
        .map((a) => ({ start: a.startsAt, end: a.blockEndsAt })),
    ];
    const slots = computeSlots({
      date,
      timeZone: tz,
      windows: hours.map((h) => ({ start: h.startTime, end: h.endTime })),
      busy,
      durationMinutes: service.durationMinutes,
      bufferMinutes: service.bufferMinutes,
      stepMinutes: tenant.slotStepMinutes,
      now,
      minAdvanceMinutes: params.ignoreAdvance ? 0 : tenant.minAdvanceMinutes,
      maxHorizonDays: params.ignoreAdvance ? 3650 : tenant.maxHorizonDays,
    });
    for (const s of slots) {
      const k = s.getTime();
      result.set(k, [...(result.get(k) ?? []), pro.id]);
    }
  }
  return [...result.entries()].sort((a, b) => a[0] - b[0]).map(([k, ids]) => ({ startsAt: new Date(k).toISOString(), professionalIds: ids }));
}

/** Fuso usado para interpretar a data de um horário (unidade escolhida → profissional → primeira unidade). */
async function resolveTimezone(tenant: Tenant, unitId?: string | null, professionalId?: string | null) {
  const db = tenantDb(tenant.id);
  if (unitId) {
    const u = await db.unit.findFirst({ where: { id: unitId, active: true } });
    if (!u) throw Errors.notFound("Unidade");
    return u.timezone;
  }
  if (professionalId) {
    const p = await db.professional.findFirst({ where: { id: professionalId }, include: { unit: true } });
    if (p) return p.unit.timezone;
  }
  return (await db.unit.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }))?.timezone ?? tenant.timezone;
}

export interface BookingInput {
  tenant: Tenant;
  serviceId: string;
  professionalId: string | null; // null = qualquer disponível
  unitId?: string | null;
  startsAt: string; // ISO
  customer: CustomerInput;
  couponCode?: string | null;
  source: "public" | "manual";
  actorId?: string | null;
  /** Recepção pode registrar sem sinal (ex.: pago no balcão). */
  skipDeposit?: boolean;
  now?: Date;
}

export interface BookingResult {
  appointment: Appointment;
  token: string;
  payment: { amountCents: number; pixCopyPaste: string | null; expiresAt: Date } | null;
  creditAppliedCents: number;
  discountCents: number;
}

export async function createBooking(input: BookingInput): Promise<BookingResult> {
  const now = input.now ?? new Date();
  const { tenant } = input;
  if (tenant.status !== "active" && tenant.status !== "onboarding") throw Errors.policy("Agenda indisponível no momento");
  parseCustomer(input.customer); // valida antes de qualquer escrita

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw Errors.validation("Horário inválido");

  const db = tenantDb(tenant.id);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) throw Errors.notFound("Serviço");

  // Revalida no servidor: o horário precisa estar na disponibilidade atual.
  const tz = await resolveTimezone(tenant, input.unitId, input.professionalId);
  const options = await getAvailability({
    tenant,
    serviceId: service.id,
    professionalId: input.professionalId,
    unitId: input.unitId,
    date: localDate(startsAt, tz),
    now,
    ignoreAdvance: input.source === "manual",
  });
  const option = options.find((o) => o.startsAt === startsAt.toISOString());
  if (!option) throw Errors.slotUnavailable();

  const customer = await upsertCustomer(tenant.id, input.customer, input.source, now);

  // Cupom (Fase 2): desconto sobre o preço; o sinal é calculado sobre o preço final.
  let discountCents = 0;
  let couponId: string | null = null;
  if (input.couponCode?.trim()) {
    const q = await quoteCoupon({ tenantId: tenant.id, code: input.couponCode, serviceId: service.id, priceCents: service.priceCents, customerId: customer.id, now });
    discountCents = q.discountCents;
    couponId = q.coupon.id;
  }
  const finalPrice = service.priceCents - discountCents;
  const depositCents = input.skipDeposit ? 0 : computeDepositCents(finalPrice, service.depositType, service.depositValue);
  const endsAt = addMinutes(startsAt, service.durationMinutes);
  const blockEndsAt = addMinutes(endsAt, service.bufferMinutes);

  let appointment: Appointment | null = null;
  let creditApplied = 0;
  for (const professionalId of option.professionalIds) {
    try {
      // withTxRetry: deadlock/timeout de lock sob disputa são retentados; conflito real de horário não.
      const res = await withTxRetry(() => prisma.$transaction(async (tx) => {
        await expireStaleHolds(tx, professionalId, now);
        const pro = await tx.professional.findFirstOrThrow({ where: { id: professionalId, tenantId: tenant.id } });
        // Crédito do cliente (Fase 2) abate o sinal; o resto vai via Pix.
        // FOR UPDATE serializa reservas simultâneas do mesmo cliente (sem gasto duplo de crédito).
        if (depositCents > 0) await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id} FOR UPDATE`;
        const balance = depositCents > 0 ? await creditBalance(tx, tenant.id, customer.id) : 0;
        const useCredit = Math.min(balance, depositCents);
        const pixCents = depositCents - useCredit;
        const status: AppointmentStatus = pixCents > 0 ? "aguardando_sinal" : depositCents > 0 ? "confirmado" : "pendente";
        if (couponId) await redeemCoupon(tx, couponId);
        const created = await tx.appointment.create({
          data: {
            tenantId: tenant.id,
            unitId: pro.unitId,
            customerId: customer.id,
            professionalId,
            serviceId: service.id,
            startsAt,
            endsAt,
            blockEndsAt,
            status,
            source: input.source,
            priceSnapshotCents: finalPrice,
            depositAmountSnapshotCents: depositCents,
            couponId,
            discountCents,
            creditAppliedCents: useCredit,
            holdExpiresAt: pixCents > 0 ? addMinutes(now, tenant.holdMinutes) : null,
            presenceDeadlineAt: status === "pendente" ? new Date(startsAt.getTime() - tenant.presenceDeadlineHours * 3600_000) : null,
          },
        });
        if (useCredit > 0) {
          await tx.customerCredit.create({
            data: { tenantId: tenant.id, customerId: customer.id, appointmentId: created.id, amountCents: -useCredit, reason: "usado no sinal" },
          });
        }
        await tx.appointmentEvent.create({
          data: {
            tenantId: tenant.id,
            appointmentId: created.id,
            actorId: input.actorId ?? null,
            eventType: "created",
            payloadJson: { status, source: input.source, depositCents, creditApplied: useCredit, discountCents, couponId },
          },
        });
        return { created, useCredit };
      }, BOOKING_TX));
      appointment = res.created;
      creditApplied = res.useCredit;
      break;
    } catch (err) {
      // Conflito de horário (ou disputa que não se resolveu): tenta o próximo profissional.
      if (isOverlapViolation(err) || isTransientTxError(err)) continue;
      throw err;
    }
  }
  if (!appointment) throw Errors.slotTaken();

  const token = await signActionToken(appointment.id, tenant.id, actionTokenExpiry(startsAt));
  const pixCents = depositCents - creditApplied;

  let payment: BookingResult["payment"] = null;
  if (pixCents > 0) {
    const expiresAt = appointment.holdExpiresAt!;
    try {
      const conn = await db.paymentConnection.findFirst({ where: { status: "connected" } });
      const provider = paymentProvider(conn?.provider);
      const charge = await provider.createPixCharge({
        tenantId: tenant.id,
        appointmentId: appointment.id,
        amountCents: pixCents,
        expiresAt,
        description: `Sinal ${service.name} — ${tenant.name}`,
        credentials: conn?.encryptedCredentials ? decryptJson(conn.encryptedCredentials) : null,
      });
      await db.payment.create({
        data: {
          tenantId: tenant.id,
          appointmentId: appointment.id,
          provider: provider.name,
          providerChargeId: charge.chargeId,
          amountCents: pixCents,
          pixCopyPaste: charge.pixCopyPaste,
          expiresAt,
        },
      });
      payment = { amountCents: pixCents, pixCopyPaste: charge.pixCopyPaste, expiresAt };
    } catch (err) {
      // Falha no PSP: libera o horário imediatamente (e devolve crédito/cupom).
      await prisma.$transaction(async (tx) => {
        const r = await tx.appointment.updateMany({ where: { id: appointment!.id, status: "aguardando_sinal" }, data: { status: "expirado" } });
        if (r.count) await releaseExpiredSideEffects(tx, [appointment!.id]);
      });
      console.error("[pagamento] falha ao criar cobrança", err instanceof Error ? err.message : err);
      throw new AppError("payment_unavailable", "Não foi possível gerar o Pix agora. Tente novamente em instantes.", 503);
    }
    await scheduleAppointmentMessagesSafe(appointment.id, "payment_pending");
  } else {
    await scheduleAppointmentMessagesSafe(appointment.id, "booked");
  }

  return { appointment, token, payment, creditAppliedCents: creditApplied, discountCents };
}

type Actor = { kind: "customer" } | { kind: "staff"; userId: string };

async function loadAppointment(tenantId: string, appointmentId: string) {
  const appt = await tenantDb(tenantId).appointment.findFirst({
    where: { id: appointmentId },
    include: { tenant: true, payments: true, service: true },
  });
  if (!appt) throw Errors.notFound("Agendamento");
  return appt;
}

/**
 * Cancelamento (§8, §9 e Fase 2):
 *  - cliente dentro do prazo ou cancelamento pela empresa → sinal volta (reembolso ou crédito);
 *  - cliente fora do prazo → retém `lateCancelRetainPercent` do sinal.
 */
export async function cancelAppointment(tenantId: string, appointmentId: string, actor: Actor, reason?: string, now = new Date()) {
  const appt = await loadAppointment(tenantId, appointmentId);
  if (!ACTIVE_STATUSES.includes(appt.status)) throw Errors.policy("Este agendamento não pode mais ser cancelado");
  if (actor.kind === "customer" && appt.startsAt <= now) throw Errors.policy("O horário já passou");

  const withinWindow = isWithinCancelWindow(appt.startsAt, appt.tenant.cancelLimitHours, now);
  const paid = appt.payments.find((p) => p.status === "paid") ?? null;
  const hasDeposit = !!paid || (appt.creditAppliedCents > 0 && appt.status !== "aguardando_sinal");
  const late = actor.kind === "customer" && !withinWindow;
  const retainPercent = late ? appt.tenant.lateCancelRetainPercent : 0;
  // Cancelamento pela empresa sempre devolve em dinheiro (se houve Pix).
  const mode = actor.kind === "staff" ? "refund" : appt.tenant.depositRefundMode;
  const settlement = hasDeposit
    ? computeSettlement({ pixPaidCents: paid?.amountCents ?? 0, creditAppliedCents: appt.creditAppliedCents, retainPercent, mode })
    : null;

  await prisma.$transaction(async (tx) => {
    const res = await tx.appointment.updateMany({
      where: { id: appt.id, tenantId, status: { in: ACTIVE_STATUSES } },
      data: { status: "cancelado", holdExpiresAt: null },
    });
    if (res.count !== 1) throw Errors.policy("Este agendamento não pode mais ser cancelado");
    if (appt.status === "aguardando_sinal") {
      await releaseExpiredSideEffects(tx, [appt.id]); // devolve crédito/cupom da reserva não paga
    } else if (settlement) {
      await applySettlement(tx, { tenantId, customerId: appt.customerId, appointmentId: appt.id, payment: paid, settlement, reason: "cancelamento" });
    }
    await tx.appointmentEvent.create({
      data: {
        tenantId,
        appointmentId: appt.id,
        actorId: actor.kind === "staff" ? actor.userId : null,
        eventType: "cancelled",
        payloadJson: { by: actor.kind, withinWindow, reason: reason?.slice(0, 300) ?? null, settlement: settlement ? { ...settlement } : null },
      },
    });
  });
  if (settlement?.refundCents) await processRefundSafe(paid?.id);
  await scheduleAppointmentMessagesSafe(appt.id, "cancelled");
  await notifyFreedSlot(tenantId, appt.professionalId, appt.startsAt);
  return {
    withinWindow,
    depositRetained: !!settlement && settlement.retainCents > 0,
    retainedCents: settlement?.retainCents ?? 0,
    creditedCents: settlement?.creditBackCents ?? 0,
    refundCents: settlement?.refundCents ?? 0,
  };
}

/**
 * Reagendamento atômico (§8): um único UPDATE do intervalo. A exclusion
 * constraint garante que o horário novo está livre; se falhar, o antigo
 * permanece intacto. O sinal pago acompanha o agendamento.
 */
export async function rescheduleAppointment(
  tenantId: string,
  appointmentId: string,
  newStartsAtIso: string,
  actor: Actor,
  opts: { professionalId?: string | null; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const appt = await loadAppointment(tenantId, appointmentId);
  if (appt.status !== "pendente" && appt.status !== "confirmado") throw Errors.policy("Este agendamento não pode ser remarcado");
  if (actor.kind === "customer" && !isWithinCancelWindow(appt.startsAt, appt.tenant.cancelLimitHours, now)) {
    throw Errors.policy(`Remarcações só até ${appt.tenant.cancelLimitHours}h antes. Fale com o estabelecimento.`);
  }
  const newStart = new Date(newStartsAtIso);
  if (Number.isNaN(newStart.getTime())) throw Errors.validation("Horário inválido");

  const unit = await tenantDb(tenantId).unit.findFirst({ where: { id: appt.unitId } });
  const tz = unit?.timezone ?? appt.tenant.timezone;
  const targetPro = opts.professionalId ?? appt.professionalId;
  const options = await getAvailability({
    tenant: appt.tenant,
    serviceId: appt.serviceId,
    professionalId: targetPro,
    date: localDate(newStart, tz),
    now,
    excludeAppointmentId: appt.id,
    ignoreAdvance: actor.kind === "staff",
  });
  if (!options.some((o) => o.startsAt === newStart.toISOString())) throw Errors.slotUnavailable();

  const endsAt = addMinutes(newStart, appt.service.durationMinutes);
  const blockEndsAt = addMinutes(endsAt, appt.service.bufferMinutes);
  try {
    await withTxRetry(() => prisma.$transaction(async (tx) => {
      await expireStaleHolds(tx, targetPro, now);
      const target = await tx.professional.findFirstOrThrow({ where: { id: targetPro, tenantId } });
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, tenantId, status: { in: ["pendente", "confirmado"] }, startsAt: appt.startsAt },
        data: {
          startsAt: newStart,
          endsAt,
          blockEndsAt,
          professionalId: targetPro,
          unitId: target.unitId,
          presenceDeadlineAt: new Date(newStart.getTime() - appt.tenant.presenceDeadlineHours * 3600_000),
        },
      });
      if (res.count !== 1) throw Errors.policy("O agendamento mudou. Recarregue a página.");
      await tx.appointmentEvent.create({
        data: {
          tenantId,
          appointmentId: appt.id,
          actorId: actor.kind === "staff" ? actor.userId : null,
          eventType: "rescheduled",
          payloadJson: { from: appt.startsAt.toISOString(), to: newStart.toISOString(), professionalId: targetPro },
        },
      });
    }, BOOKING_TX));
  } catch (err) {
    if (isOverlapViolation(err) || isTransientTxError(err)) throw Errors.slotTaken();
    throw err;
  }
  await scheduleAppointmentMessagesSafe(appt.id, "rescheduled");
  await notifyFreedSlot(tenantId, appt.professionalId, appt.startsAt);
}

export async function confirmPresence(tenantId: string, appointmentId: string, now = new Date()) {
  const appt = await loadAppointment(tenantId, appointmentId);
  if (appt.status !== "pendente" && appt.status !== "confirmado") throw Errors.policy("Este agendamento não está ativo");
  if (appt.confirmedPresenceAt) return;
  await prisma.$transaction([
    prisma.appointment.updateMany({
      where: { id: appt.id, tenantId, status: { in: ["pendente", "confirmado"] } },
      data: { status: "confirmado", confirmedPresenceAt: now },
    }),
    prisma.appointmentEvent.create({ data: { tenantId, appointmentId: appt.id, eventType: "presence_confirmed", payloadJson: {} } }),
  ]);
}

/**
 * Fechamento do atendimento pela equipe (§8, §9, Fase 2).
 * Concluído: sinal abatido do preço. Falta: retém `noShowRetainPercent`.
 */
export async function markOutcome(tenantId: string, appointmentId: string, outcome: "concluido" | "nao_compareceu", userId: string) {
  const appt = await loadAppointment(tenantId, appointmentId);
  if (appt.status !== "pendente" && appt.status !== "confirmado") throw Errors.policy("Agendamento não está ativo");
  const paid = appt.payments.find((p) => p.status === "paid") ?? null;
  const settlement =
    outcome === "nao_compareceu" && (paid || appt.creditAppliedCents > 0)
      ? computeSettlement({
          pixPaidCents: paid?.amountCents ?? 0,
          creditAppliedCents: appt.creditAppliedCents,
          retainPercent: appt.tenant.noShowRetainPercent,
          mode: appt.tenant.depositRefundMode,
        })
      : null;
  await prisma.$transaction(async (tx) => {
    const r = await tx.appointment.updateMany({ where: { id: appt.id, tenantId, status: { in: ["pendente", "confirmado"] } }, data: { status: outcome } });
    if (r.count !== 1) throw Errors.policy("Agendamento não está ativo");
    if (outcome === "concluido" && paid) {
      await tx.payment.update({ where: { id: paid.id }, data: { status: "applied" } });
    } else if (settlement) {
      await applySettlement(tx, { tenantId, customerId: appt.customerId, appointmentId: appt.id, payment: paid, settlement, reason: "falta" });
    }
    await tx.appointmentEvent.create({
      data: { tenantId, appointmentId: appt.id, actorId: userId, eventType: outcome, payloadJson: settlement ? { settlement: { ...settlement } } : {} },
    });
  });
  if (settlement?.refundCents) await processRefundSafe(paid?.id);
}
