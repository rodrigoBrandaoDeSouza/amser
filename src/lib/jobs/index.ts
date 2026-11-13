import { prisma } from "../db";
import { audit } from "../audit";
import { processOutbox } from "../whatsapp/outbox";
import { storage } from "../storage";
import { notifyFreedSlot, releaseExpiredSideEffects } from "../scheduling/booking";
import { processRefund } from "../scheduling/deposit-policy";
import { expireWaitlistEntries } from "../waitlist";
import { runBillingCycle } from "../billing/service";
import { refreshInstagramTokens } from "../instagram/service";
import { applyRetention } from "../crm";
import { purgeScheduledDeletions } from "../ops";

/** Expira reservas provisórias (Pix não pago), devolve crédito/cupom e oferece o horário à lista de espera. */
export async function expireHolds(now = new Date()) {
  const stale = await prisma.appointment.findMany({
    where: { status: "aguardando_sinal", holdExpiresAt: { lt: now } },
    select: { id: true, tenantId: true, professionalId: true, startsAt: true },
    take: 500,
  });
  let expired = 0;
  for (const a of stale) {
    const ok = await prisma.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({
        where: { id: a.id, status: "aguardando_sinal", holdExpiresAt: { lt: now } },
        data: { status: "expirado" },
      });
      if (res.count !== 1) return false;
      await releaseExpiredSideEffects(tx, [a.id]);
      await tx.appointmentEvent.create({ data: { tenantId: a.tenantId, appointmentId: a.id, eventType: "hold_expired", payloadJson: {} } });
      return true;
    });
    if (ok) {
      expired++;
      await notifyFreedSlot(a.tenantId, a.professionalId, a.startsAt);
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
    select: { id: true, tenantId: true, professionalId: true, startsAt: true },
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
      await prisma.appointmentEvent.create({ data: { tenantId: a.tenantId, appointmentId: a.id, eventType: "auto_released", payloadJson: {} } });
      await notifyFreedSlot(a.tenantId, a.professionalId, a.startsAt);
    }
  }
  return released;
}

/** Reembolsos automáticos que falharam: nova tentativa (Fase 2). */
export async function retryRefunds() {
  const pending = await prisma.payment.findMany({ where: { needsRefund: true }, select: { id: true }, take: 100 });
  let ok = 0;
  for (const p of pending) if ((await processRefund(p.id)) === "refunded") ok++;
  return ok;
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
  const refunds = await retryRefunds();
  const waitlist = await expireWaitlistEntries(now);
  const billing = await runBillingCycle(now);
  const instagram = await refreshInstagramTokens(now);
  const prospects = await purgeExpiredProspects(now);
  const deletions = await purgeScheduledDeletions(now);
  // Retenção LGPD: uma janela diária (06:00–06:10 UTC); idempotente se rodar mais de uma vez.
  const retention = now.getUTCHours() === 6 && now.getUTCMinutes() < 10 ? await applyRetention(now) : 0;
  return { holds, released, outbox, refunds, waitlist, billing, instagram, prospects, deletions, retention };
}
