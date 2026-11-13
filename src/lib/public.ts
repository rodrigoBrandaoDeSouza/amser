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
  professionals: { id: string; name: string }[];
}

export async function getPublicCatalog(tenantId: string): Promise<PublicService[]> {
  const services = await tenantDb(tenantId).service.findMany({
    where: { active: true },
    include: {
      category: true,
      professionals: { include: { professional: { select: { id: true, displayName: true, active: true } } } },
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
        .filter((p) => p.professional.active)
        .map((p) => ({ id: p.professional.id, name: p.professional.displayName })),
    }))
    .filter((s) => s.professionals.length > 0);
}

export function cancellationPolicy(t: Tenant): string {
  return (
    t.cancellationPolicyText?.trim() ||
    `Cancelamentos e remarcações gratuitos até ${t.cancelLimitHours}h antes do horário. ` +
      `Depois disso, ou em caso de falta, o sinal pago não é devolvido.`
  );
}
