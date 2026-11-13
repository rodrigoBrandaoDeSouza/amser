import type { Tenant } from "@prisma/client";
import { prisma, tenantDb } from "./db";
import { Errors } from "./errors";

export interface PlanLimits {
  professionals: number;
  units: number;
}

export async function planLimits(tenant: Pick<Tenant, "planId">): Promise<PlanLimits> {
  const plan = tenant.planId ? await prisma.plan.findUnique({ where: { id: tenant.planId } }) : null;
  const l = (plan?.limitsJson ?? {}) as Partial<Record<keyof PlanLimits, number>>;
  return {
    professionals: typeof l.professionals === "number" ? l.professionals : Number.POSITIVE_INFINITY,
    units: typeof l.units === "number" ? l.units : 1,
  };
}

/** Bloqueia cadastros além do limite do plano (profissionais ativos / unidades ativas). */
export async function assertWithinPlan(tenant: Tenant, what: keyof PlanLimits) {
  const limits = await planLimits(tenant);
  const db = tenantDb(tenant.id);
  const count = what === "professionals" ? await db.professional.count({ where: { active: true } }) : await db.unit.count({ where: { active: true } });
  if (count >= limits[what]) {
    throw Errors.policy(
      what === "professionals"
        ? `Seu plano permite ${limits.professionals} profissional(is) ativo(s). Fale com a gente para mudar de plano.`
        : `Seu plano permite ${limits.units} unidade(s). Fale com a gente para mudar de plano.`,
    );
  }
}
