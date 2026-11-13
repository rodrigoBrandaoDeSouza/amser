import { SignJWT, jwtVerify } from "jose";
import type { Prisma, Tenant } from "@prisma/client";
import { prisma, tenantDb } from "./db";
import { env } from "./env";
import { Errors } from "./errors";
import { addDays, isValidDate, localDate, zonedToUtc } from "./time";
import { upsertCustomer, type CustomerInput } from "./customers";
import { createBooking, getAvailability } from "./scheduling/booking";

/**
 * Lista de espera (Fase 2, pilar 2): quando um horário é liberado
 * (cancelamento, Pix expirado, falta de confirmação, remarcação), os primeiros
 * da fila para aquele dia recebem um link no WhatsApp. Quem reservar primeiro
 * fica com o horário (a exclusion constraint resolve a disputa).
 */

export const MAX_ACTIVE_ENTRIES_PER_CUSTOMER = 3;
export const OFFERS_PER_FREED_SLOT = 3;
export const MAX_OFFERS_PER_ENTRY = 3;

const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function signWaitlistToken(entryId: string, tenantId: string, expiresAt: Date) {
  return new SignJWT({ wid: entryId, tid: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("amser:waitlist")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
}

export async function verifyWaitlistToken(token: string): Promise<{ wid: string; tid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "amser:waitlist", algorithms: ["HS256"] });
    return typeof payload.wid === "string" && typeof payload.tid === "string" ? { wid: payload.wid, tid: payload.tid } : null;
  } catch {
    return null;
  }
}

export async function joinWaitlist(input: {
  tenant: Tenant;
  serviceId: string;
  professionalId: string | null;
  unitId?: string | null;
  date: string;
  customer: CustomerInput;
  now?: Date;
}) {
  const { tenant } = input;
  const now = input.now ?? new Date();
  if (!tenant.waitlistEnabled) throw Errors.policy("Lista de espera indisponível");
  if (!isValidDate(input.date)) throw Errors.validation("Data inválida");
  const today = localDate(now, tenant.timezone);
  if (input.date < today || input.date > addDays(today, tenant.maxHorizonDays)) throw Errors.validation("Data fora do período de agendamento");
  if (!input.customer.consentWhatsapp) throw Errors.validation("Para entrar na lista, aceite receber o aviso pelo WhatsApp");

  const db = tenantDb(tenant.id);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true }, include: { professionals: true } });
  if (!service) throw Errors.notFound("Serviço");
  if (input.professionalId && !service.professionals.some((p) => p.professionalId === input.professionalId)) throw Errors.notFound("Profissional");

  const customer = await upsertCustomer(tenant.id, input.customer, "waitlist", now);
  const active = await db.waitlistEntry.findMany({ where: { customerId: customer.id, status: { in: ["waiting", "offered"] } } });
  const dup = active.find((e) => e.serviceId === service.id && e.date === input.date && (e.professionalId ?? null) === (input.professionalId ?? null));
  if (dup) return dup;
  if (active.length >= MAX_ACTIVE_ENTRIES_PER_CUSTOMER) throw Errors.policy("Você já está em 3 listas de espera. Aguarde um aviso ou fale com o estabelecimento.");

  return db.waitlistEntry.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      serviceId: service.id,
      professionalId: input.professionalId,
      unitId: input.unitId ?? null,
      date: input.date,
    },
  });
}

/** Chamado quando um horário é liberado. Retorna quantas ofertas foram enviadas. */
export async function offerFreedSlot(tenantId: string, professionalId: string, freedStart: Date, now = new Date()): Promise<number> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || !tenant.waitlistEnabled || tenant.status !== "active") return 0;
  if (freedStart <= now) return 0;
  const db = tenantDb(tenantId);
  const pro = await db.professional.findFirst({ where: { id: professionalId }, include: { unit: true, services: true } });
  if (!pro) return 0;
  const date = localDate(freedStart, pro.unit.timezone);

  const entries = await db.waitlistEntry.findMany({
    where: {
      date,
      status: { in: ["waiting", "offered"] },
      offersCount: { lt: MAX_OFFERS_PER_ENTRY },
      serviceId: { in: pro.services.map((s) => s.serviceId) },
      OR: [{ professionalId: null }, { professionalId }],
      AND: [{ OR: [{ unitId: null }, { unitId: pro.unitId }] }],
    },
    include: { customer: true, service: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  let offers = 0;
  for (const e of entries) {
    if (offers >= OFFERS_PER_FREED_SLOT) break;
    // Só oferta se de fato houver horário para o serviço da pessoa.
    const slots = await getAvailability({ tenant, serviceId: e.serviceId, professionalId: e.professionalId ?? professionalId, date, now });
    if (!slots.length) continue;
    const consent = (e.customer.consentJson as Record<string, unknown>)?.whatsapp === true;
    if (!consent) continue;

    const token = await signWaitlistToken(e.id, tenantId, zonedToUtc(addDays(date, 1), "00:00", pro.unit.timezone));
    const when = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    await prisma.$transaction([
      db.waitlistEntry.update({ where: { id: e.id }, data: { status: "offered", offeredAt: now, offersCount: { increment: 1 } } }),
      prisma.messageOutbox.createMany({
        data: [
          {
            tenantId,
            appointmentId: null,
            eventType: "waitlist_offer",
            toPhoneE164: e.customer.phoneE164,
            payloadJson: {
              customerName: e.customer.name.split(" ")[0],
              serviceName: e.service.name,
              tenantName: tenant.name,
              when: `${when} — abriu um horário`,
              startsAt: "",
              token,
            } as Prisma.InputJsonValue,
            idempotencyKey: `${e.id}:waitlist_offer:${freedStart.toISOString()}`,
            scheduledAt: now,
          },
        ],
        skipDuplicates: true,
      }),
    ]);
    offers++;
  }
  return offers;
}

/** Reserva a partir do link da oferta. */
export async function bookFromWaitlist(token: string, startsAtIso: string) {
  const claims = await verifyWaitlistToken(token);
  if (!claims) throw Errors.notFound("Oferta");
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tid } });
  if (!tenant) throw Errors.notFound("Oferta");
  const db = tenantDb(tenant.id);
  const entry = await db.waitlistEntry.findFirst({ where: { id: claims.wid }, include: { customer: true } });
  if (!entry || !["waiting", "offered"].includes(entry.status)) throw Errors.policy("Esta oferta não está mais disponível");
  const result = await createBooking({
    tenant,
    serviceId: entry.serviceId,
    professionalId: entry.professionalId,
    unitId: entry.unitId,
    startsAt: startsAtIso,
    customer: { name: entry.customer.name, phone: entry.customer.phoneE164, email: entry.customer.email, consentWhatsapp: true },
    source: "public",
  });
  await db.waitlistEntry.update({ where: { id: entry.id }, data: { status: "booked", bookedAppointmentId: result.appointment.id } });
  return result;
}

export async function cancelWaitlistEntry(tenantId: string, entryId: string) {
  await tenantDb(tenantId).waitlistEntry.updateMany({ where: { id: entryId, status: { in: ["waiting", "offered"] } }, data: { status: "cancelled" } });
}

/** Encerra entradas de dias que já passaram (no fuso de cada tenant). */
export async function expireWaitlistEntries(now = new Date()): Promise<number> {
  return prisma.$executeRaw`
    UPDATE waitlist_entries w SET status = 'expired'
    FROM tenants t
    WHERE w.tenant_id = t.id
      AND w.status IN ('waiting', 'offered')
      AND w.date < to_char(${now}::timestamptz AT TIME ZONE t.timezone, 'YYYY-MM-DD')`;
}
