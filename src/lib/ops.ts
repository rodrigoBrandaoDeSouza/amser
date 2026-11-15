import { prisma } from "./db";
import { audit } from "./audit";
import { Errors } from "./errors";
import { storage } from "./storage";

/**
 * Operação (§13): gestão das empresas pelo superadmin e exclusão programada.
 */
export const DELETION_GRACE_DAYS = 30;

/**
 * O superadmin gerencia o painel de qualquer empresa não excluída, sem
 * autorização prévia do dono (ADR 0016). Tudo o que ele faz fica na
 * auditoria com o id dele, e o dono vê os acessos em Configurações.
 */
export async function assertManageable(tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t || t.status === "deleted") throw Errors.notFound("Empresa");
  return t;
}

/** Últimos acessos da equipe Amser ao painel da empresa (transparência para o dono). */
export async function supportAccessLog(tenantId: string, take = 10) {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId, action: "support.enter" },
    orderBy: { createdAt: "desc" },
    take,
  });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.actorId);
    return { at: r.createdAt, who: u?.name || u?.email || "Equipe Amser" };
  });
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
