import { prisma } from "./db";
import { audit } from "./audit";
import { Errors } from "./errors";
import { storage } from "./storage";

/**
 * Operação (§13): acesso de suporte autorizado pelo dono e exclusão
 * programada de empresas.
 */
export const SUPPORT_HOURS = [2, 24, 72] as const;
export const DELETION_GRACE_DAYS = 30;

/** O dono autoriza a equipe Amser a acessar o painel por algumas horas. */
export async function grantSupportAccess(tenantId: string, hours: number, actorId: string) {
  if (!SUPPORT_HOURS.includes(hours as (typeof SUPPORT_HOURS)[number])) throw Errors.validation("Prazo inválido");
  const until = new Date(Date.now() + hours * 3600_000);
  await prisma.tenant.update({ where: { id: tenantId }, data: { supportAccessUntil: until } });
  await audit({ tenantId, actorId, action: "support.granted", resource: `tenant:${tenantId}`, meta: { hours } });
  return until;
}

export async function revokeSupportAccess(tenantId: string, actorId: string) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { supportAccessUntil: null } });
  await audit({ tenantId, actorId, action: "support.revoked", resource: `tenant:${tenantId}` });
}

/** Superadmin entra em modo suporte (só com autorização vigente). */
export async function assertSupportAllowed(tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw Errors.notFound("Empresa");
  if (!t.supportAccessUntil || t.supportAccessUntil < new Date()) throw Errors.policy("O dono ainda não autorizou o acesso de suporte (Configurações → Acesso de suporte)");
  return t;
}

export async function scheduleDeletion(tenantId: string, actorId: string, days = DELETION_GRACE_DAYS) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t || t.status === "deleted") throw Errors.notFound("Empresa");
  const at = new Date(Date.now() + days * 86400_000);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { deletionScheduledAt: at, ...(t.status === "active" || t.status === "onboarding" ? { status: "suspended", suspendedReason: "deletion", statusBeforeSuspension: t.status } : {}) },
  });
  await audit({ tenantId, actorId, action: "tenant.deletion_scheduled", resource: `tenant:${tenantId}`, meta: { at: at.toISOString() } });
  return at;
}

export async function cancelDeletion(tenantId: string, actorId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t?.deletionScheduledAt) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      deletionScheduledAt: null,
      ...(t.suspendedReason === "deletion" ? { status: t.statusBeforeSuspension ?? "onboarding", suspendedReason: null, statusBeforeSuspension: null } : {}),
    },
  });
  await audit({ tenantId, actorId, action: "tenant.deletion_canceled", resource: `tenant:${tenantId}` });
}

/** Job: apaga definitivamente empresas cujo prazo terminou (mídias + dados em cascata). */
export async function purgeScheduledDeletions(now = new Date()): Promise<number> {
  const due = await prisma.tenant.findMany({ where: { deletionScheduledAt: { lt: now } }, include: { media: true } });
  for (const t of due) {
    for (const m of t.media) await storage().delete(m.storageKey).catch(() => undefined);
    await prisma.tenant.delete({ where: { id: t.id } });
    await audit({ action: "tenant.purged", resource: `tenant:${t.id}`, meta: { slug: t.slug } });
  }
  return due.length;
}
