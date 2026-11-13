import { prisma } from "../db";
import { audit } from "../audit";
import { processOutbox } from "../whatsapp/outbox";
import { storage } from "../storage";

/** Expira reservas provisórias (Pix não pago) e libera os horários (§9). */
export async function expireHolds(now = new Date()) {
  const stale = await prisma.appointment.findMany({
    where: { status: "aguardando_sinal", holdExpiresAt: { lt: now } },
    select: { id: true, tenantId: true },
    take: 500,
  });
  let expired = 0;
  for (const a of stale) {
    const res = await prisma.appointment.updateMany({
      where: { id: a.id, status: "aguardando_sinal", holdExpiresAt: { lt: now } },
      data: { status: "expirado" },
    });
    if (res.count === 1) {
      expired++;
      await prisma.payment.updateMany({ where: { appointmentId: a.id, status: "pending" }, data: { status: "expired" } });
      await prisma.appointmentEvent.create({
        data: { tenantId: a.tenantId, appointmentId: a.id, eventType: "hold_expired", payloadJson: {} },
      });
    }
  }
  return expired;
}

/**
 * Sem confirmação de presença até o prazo (§8): libera o horário se o tenant
 * ativou autoReleaseUnconfirmed; caso contrário só fica sinalizado no painel.
 */
export async function releaseUnconfirmed(now = new Date()) {
  const list = await prisma.appointment.findMany({
    where: {
      status: "pendente",
      confirmedPresenceAt: null,
      presenceDeadlineAt: { lt: now },
      startsAt: { gt: now },
      tenant: { autoReleaseUnconfirmed: true },
    },
    select: { id: true, tenantId: true },
    take: 500,
  });
  let released = 0;
  for (const a of list) {
    const res = await prisma.appointment.updateMany({
      where: { id: a.id, status: "pendente", confirmedPresenceAt: null },
      data: { status: "cancelado" },
    });
    if (res.count === 1) {
      released++;
      await prisma.appointmentEvent.create({
        data: { tenantId: a.tenantId, appointmentId: a.id, eventType: "auto_released", payloadJson: {} },
      });
    }
  }
  return released;
}

/** LGPD (§4.1): prévias de prospect expiradas são apagadas com as mídias. */
export async function purgeExpiredProspects(now = new Date()) {
  const expired = await prisma.tenant.findMany({
    where: { status: "prospect", previewExpiresAt: { lt: now } },
    include: { media: true },
  });
  for (const t of expired) {
    for (const m of t.media) await storage().delete(m.storageKey).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: t.id } });
    await audit({ action: "prospect.purged", resource: `tenant:${t.id}`, meta: { slug: t.slug } });
  }
  return expired.length;
}

export async function runAllJobs(now = new Date()) {
  const holds = await expireHolds(now);
  const released = await releaseUnconfirmed(now);
  const outbox = await processOutbox(now);
  const prospects = await purgeExpiredProspects(now);
  return { holds, released, outbox, prospects };
}
