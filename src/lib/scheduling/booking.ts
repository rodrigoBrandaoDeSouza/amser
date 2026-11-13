import type { Appointment, AppointmentStatus, Prisma, Tenant } from "@prisma/client";
import { prisma, isOverlapViolation, tenantDb } from "../db";
import { Errors, AppError } from "../errors";
import { addMinutes, localDate, isValidDate, weekdayOf } from "../time";
import { normalizePhoneBR } from "../format";
import { computeSlots, dayBounds, type Interval } from "./availability";
import { computeDepositCents, isWithinCancelWindow } from "./deposit";
import { paymentProvider } from "../payments/provider";
import { decryptJson } from "../crypto";
import { scheduleAppointmentMessagesSafe } from "../whatsapp/outbox";
import { actionTokenExpiry, signActionToken } from "../tokens";

export const ACTIVE_STATUSES: AppointmentStatus[] = ["aguardando_sinal", "pendente", "confirmado"];

export interface SlotOption {
  startsAt: string; // ISO UTC
  professionalIds: string[];
}

/** Expira reservas provisórias vencidas de um profissional (dentro da transação). */
async function expireStaleHolds(tx: Prisma.TransactionClient, professionalId: string, now: Date) {
  const stale = await tx.appointment.findMany({
    where: { professionalId, status: "aguardando_sinal", holdExpiresAt: { lt: now } },
    select: { id: true },
  });
  if (!stale.length) return;
  const ids = stale.map((s) => s.id);
  await tx.appointment.updateMany({ where: { id: { in: ids }, status: "aguardando_sinal" }, data: { status: "expirado" } });
  await tx.payment.updateMany({ where: { appointmentId: { in: ids }, status: "pending" }, data: { status: "expired" } });
}

/**
 * Disponibilidade de um serviço em uma data (§7). Se professionalId for null,
 * considera qualquer profissional habilitado.
 */
export async function getAvailability(params: {
  tenant: Tenant;
  serviceId: string;
  professionalId: string | null;
  date: string;
  now?: Date;
  /** Agendamento a ignorar (remarcação do próprio). */
  excludeAppointmentId?: string;
  /** Agendamento manual pela recepção: ignora antecedência mínima. */
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

  let pros = service.professionals.map((sp) => sp.professional).filter((p) => p.active);
  if (params.professionalId) pros = pros.filter((p) => p.id === params.professionalId);
  if (!pros.length) return [];

  const weekday = weekdayOf(date);
  const result = new Map<number, string[]>();

  for (const pro of pros) {
    const tz = pro.unit.timezone;
    const bounds = dayBounds(date, tz);
    const [hours, exceptions, appts] = await Promise.all([
      db.workingHour.findMany({ where: { professionalId: pro.id, weekday } }),
      db.scheduleException.findMany({
        where: {
          OR: [{ professionalId: pro.id }, { professionalId: null }],
          startsAt: { lt: bounds.end },
          endsAt: { gt: bounds.start },
        },
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
  return [...result.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, ids]) => ({ startsAt: new Date(k).toISOString(), professionalIds: ids }));
}

export interface BookingInput {
  tenant: Tenant;
  serviceId: string;
  professionalId: string | null; // null = qualquer disponível
  startsAt: string; // ISO
  customer: { name: string; phone: string; email?: string | null; consentWhatsapp: boolean };
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
}

export async function createBooking(input: BookingInput): Promise<BookingResult> {
  const now = input.now ?? new Date();
  const { tenant } = input;
  if (tenant.status !== "active" && tenant.status !== "onboarding") throw Errors.policy("Agenda indisponível no momento");

  const name = input.customer.name.trim();
  if (name.length < 2 || name.length > 120) throw Errors.validation("Informe seu nome");
  const phone = normalizePhoneBR(input.customer.phone);
  if (!phone) throw Errors.validation("Telefone inválido. Use DDD + número.");
  const email = input.customer.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.validation("E-mail inválido");

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw Errors.validation("Horário inválido");

  const db = tenantDb(tenant.id);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) throw Errors.notFound("Serviço");

  // Revalida no servidor: o horário precisa estar na disponibilidade atual.
  const unitTz = (await db.unit.findFirst({ orderBy: { name: "asc" } }))?.timezone ?? tenant.timezone;
  const date = localDate(startsAt, unitTz);
  const options = await getAvailability({
    tenant,
    serviceId: service.id,
    professionalId: input.professionalId,
    date,
    now,
    ignoreAdvance: input.source === "manual",
  });
  const option = options.find((o) => o.startsAt === startsAt.toISOString());
  if (!option) throw Errors.slotUnavailable();

  const depositCents = input.skipDeposit ? 0 : computeDepositCents(service.priceCents, service.depositType, service.depositValue);
  const status: AppointmentStatus = depositCents > 0 ? "aguardando_sinal" : "pendente";
  const endsAt = addMinutes(startsAt, service.durationMinutes);
  const blockEndsAt = addMinutes(endsAt, service.bufferMinutes);

  // Cliente: deduplicação por telefone dentro do tenant (§10).
  const existing = await db.customer.findFirst({ where: { phoneE164: phone } });
  const consent = {
    ...((existing?.consentJson as Record<string, unknown>) ?? {}),
    whatsapp: input.customer.consentWhatsapp,
    whatsappAt: now.toISOString(),
    source: input.source,
  };
  const customer = existing
    ? await db.customer.update({ where: { id: existing.id }, data: { name, email: email ?? existing.email, consentJson: consent } })
    : await db.customer.create({ data: { tenantId: tenant.id, name, phoneE164: phone, email, consentJson: consent } });

  let appointment: Appointment | null = null;
  for (const professionalId of option.professionalIds) {
    try {
      appointment = await prisma.$transaction(async (tx) => {
        await expireStaleHolds(tx, professionalId, now);
        const pro = await tx.professional.findFirstOrThrow({ where: { id: professionalId, tenantId: tenant.id } });
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
            priceSnapshotCents: service.priceCents,
            depositAmountSnapshotCents: depositCents,
            holdExpiresAt: depositCents > 0 ? addMinutes(now, tenant.holdMinutes) : null,
            presenceDeadlineAt:
              status === "pendente" ? new Date(startsAt.getTime() - tenant.presenceDeadlineHours * 3600_000) : null,
          },
        });
        await tx.appointmentEvent.create({
          data: {
            tenantId: tenant.id,
            appointmentId: created.id,
            actorId: input.actorId ?? null,
            eventType: "created",
            payloadJson: { status, source: input.source, depositCents },
          },
        });
        return created;
      });
      break;
    } catch (err) {
      if (isOverlapViolation(err)) continue; // concorrência: tenta o próximo profissional
      throw err;
    }
  }
  if (!appointment) throw Errors.slotTaken();

  const token = await signActionToken(appointment.id, tenant.id, actionTokenExpiry(startsAt));

  let payment: BookingResult["payment"] = null;
  if (depositCents > 0) {
    const expiresAt = appointment.holdExpiresAt!;
    try {
      const conn = await db.paymentConnection.findFirst({ where: { status: "connected" } });
      const provider = paymentProvider(conn?.provider);
      const charge = await provider.createPixCharge({
        tenantId: tenant.id,
        appointmentId: appointment.id,
        amountCents: depositCents,
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
          amountCents: depositCents,
          pixCopyPaste: charge.pixCopyPaste,
          expiresAt,
        },
      });
      payment = { amountCents: depositCents, pixCopyPaste: charge.pixCopyPaste, expiresAt };
    } catch (err) {
      // Falha no PSP: libera o horário imediatamente.
      await prisma.appointment.updateMany({
        where: { id: appointment.id, status: "aguardando_sinal" },
        data: { status: "expirado" },
      });
      console.error("[pagamento] falha ao criar cobrança", err instanceof Error ? err.message : err);
      throw new AppError("payment_unavailable", "Não foi possível gerar o Pix agora. Tente novamente em instantes.", 503);
    }
    await scheduleAppointmentMessagesSafe(appointment.id, "payment_pending");
  } else {
    await scheduleAppointmentMessagesSafe(appointment.id, "booked");
  }

  return { appointment, token, payment };
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

/** Cancelamento (§8, §9). Dentro do prazo → sinal a reembolsar; fora → retido. */
export async function cancelAppointment(tenantId: string, appointmentId: string, actor: Actor, reason?: string, now = new Date()) {
  const appt = await loadAppointment(tenantId, appointmentId);
  if (!ACTIVE_STATUSES.includes(appt.status)) throw Errors.policy("Este agendamento não pode mais ser cancelado");
  if (actor.kind === "customer" && appt.startsAt <= now) throw Errors.policy("O horário já passou");

  const withinWindow = isWithinCancelWindow(appt.startsAt, appt.tenant.cancelLimitHours, now);
  const paid = appt.payments.find((p) => p.status === "paid");

  await prisma.$transaction(async (tx) => {
    const res = await tx.appointment.updateMany({
      where: { id: appt.id, tenantId, status: { in: ACTIVE_STATUSES } },
      data: { status: "cancelado", holdExpiresAt: null },
    });
    if (res.count !== 1) throw Errors.policy("Este agendamento não pode mais ser cancelado");
    await tx.payment.updateMany({ where: { appointmentId: appt.id, status: "pending" }, data: { status: "expired" } });
    if (paid) {
      // Cliente fora do prazo: retido. Cancelamento pela empresa ou dentro do prazo: reembolso (manual no MVP).
      const retain = actor.kind === "customer" && !withinWindow;
      await tx.payment.update({
        where: { id: paid.id },
        data: retain ? { status: "retained" } : { needsRefund: true },
      });
    }
    await tx.appointmentEvent.create({
      data: {
        tenantId,
        appointmentId: appt.id,
        actorId: actor.kind === "staff" ? actor.userId : null,
        eventType: "cancelled",
        payloadJson: { by: actor.kind, withinWindow, reason: reason?.slice(0, 300) ?? null },
      },
    });
  });
  await scheduleAppointmentMessagesSafe(appt.id, "cancelled");
  return { withinWindow, depositRetained: !!paid && actor.kind === "customer" && !withinWindow };
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
    await prisma.$transaction(async (tx) => {
      await expireStaleHolds(tx, targetPro, now);
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, tenantId, status: { in: ["pendente", "confirmado"] }, startsAt: appt.startsAt },
        data: {
          startsAt: newStart,
          endsAt,
          blockEndsAt,
          professionalId: targetPro,
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
    });
  } catch (err) {
    if (isOverlapViolation(err)) throw Errors.slotTaken();
    throw err;
  }
  await scheduleAppointmentMessagesSafe(appt.id, "rescheduled");
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
    prisma.appointmentEvent.create({
      data: { tenantId, appointmentId: appt.id, eventType: "presence_confirmed", payloadJson: {} },
    }),
  ]);
}

/** Fechamento do atendimento pela equipe: concluído ou falta (§8, §9). */
export async function markOutcome(
  tenantId: string,
  appointmentId: string,
  outcome: "concluido" | "nao_compareceu",
  userId: string,
) {
  const appt = await loadAppointment(tenantId, appointmentId);
  if (appt.status !== "pendente" && appt.status !== "confirmado") throw Errors.policy("Agendamento não está ativo");
  const paid = appt.payments.find((p) => p.status === "paid");
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appt.id }, data: { status: outcome } });
    if (paid) {
      // Concluído: sinal abatido do preço. Falta: sinal retido.
      await tx.payment.update({ where: { id: paid.id }, data: { status: outcome === "concluido" ? "applied" : "retained" } });
    }
    await tx.appointmentEvent.create({
      data: { tenantId, appointmentId: appt.id, actorId: userId, eventType: outcome, payloadJson: {} },
    });
  });
}
