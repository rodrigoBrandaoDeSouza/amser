import type { Tenant } from "@prisma/client";
import { prisma, tenantDb } from "./db";
import { computeDepositCents } from "./scheduling/deposit";

/** Resolve o slug público. Só empresas publicadas (active) aparecem. */
export async function getPublicTenant(slug: string): Promise<Tenant | null> {
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const t = await prisma.tenant.findUnique({ where: { slug } });
  return t && t.status === "active" ? t : null;
}

/**
 * Catálogo exposto na página pública. Apenas campos públicos — nada de
 * IDs internos de usuários, credenciais ou dados de clientes.
 */
export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMinutes: number;
  priceCents: number;
  depositCents: number;
  professionals: { id: string; name: string; unitId: string }[];
}

export interface PublicUnit {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
}

export async function getPublicCatalog(tenantId: string): Promise<PublicService[]> {
  const services = await tenantDb(tenantId).service.findMany({
    where: { active: true },
    include: {
      category: true,
      professionals: { include: { professional: { select: { id: true, displayName: true, active: true, unitId: true, unit: { select: { active: true } } } } } },
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });
  return services
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description?.replace(/^\[exemplo\]\s*/, "") ?? null,
      category: s.category?.name ?? null,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      depositCents: computeDepositCents(s.priceCents, s.depositType, s.depositValue),
      professionals: s.professionals
        .filter((p) => p.professional.active && p.professional.unit.active)
        .map((p) => ({ id: p.professional.id, name: p.professional.displayName, unitId: p.professional.unitId })),
    }))
    .filter((s) => s.professionals.length > 0);
}

/** Unidades com ao menos um profissional ativo (Fase 2 — múltiplas unidades). */
export async function getPublicUnits(tenantId: string): Promise<PublicUnit[]> {
  const units = await tenantDb(tenantId).unit.findMany({
    where: { active: true, professionals: { some: { active: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return units.map((u) => ({ id: u.id, name: u.name, address: u.address, phone: u.phone }));
}

export function cancellationPolicy(t: Tenant): string {
  if (t.cancellationPolicyText?.trim()) return t.cancellationPolicyText.trim();
  const late =
    t.lateCancelRetainPercent >= 100
      ? "o sinal não é devolvido"
      : t.lateCancelRetainPercent <= 0
        ? "o sinal é devolvido integralmente"
        : `${t.lateCancelRetainPercent}% do sinal fica retido`;
  const noShow = t.noShowRetainPercent >= 100 ? "o sinal não é devolvido" : `${t.noShowRetainPercent}% do sinal fica retido`;
  const back = t.depositRefundMode === "credit" ? "vira crédito para o próximo agendamento" : "é reembolsado no Pix";
  return (
    `Cancelamentos e remarcações gratuitos até ${t.cancelLimitHours}h antes do horário (o sinal ${back}). ` +
    `Depois disso, ${late}. Em caso de falta, ${noShow}.`
  );
}
