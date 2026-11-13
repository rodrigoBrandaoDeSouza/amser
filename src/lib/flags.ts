import { prisma } from "./db";

/**
 * Feature flags (§13). Valor global, com sobrescrita por empresa
 * (scope = id do tenant). Sem flag no banco, vale o padrão do código.
 */
export const FLAGS = {
  self_signup: { label: "Cadastro self-service (/cadastro)", default: true },
  instagram_import: { label: "Importar fotos do Instagram", default: true },
  waitlist: { label: "Lista de espera", default: true },
  coupons: { label: "Cupons na página pública", default: true },
  ai_branding: { label: "Tema por IA", default: true },
} as const;

export type FlagKey = keyof typeof FLAGS;

export async function isEnabled(key: FlagKey, tenantId?: string | null): Promise<boolean> {
  const rows = await prisma.featureFlag.findMany({ where: { key, scope: { in: tenantId ? ["global", tenantId] : ["global"] } } });
  const tenantRow = tenantId ? rows.find((r) => r.scope === tenantId) : undefined;
  if (tenantRow) return tenantRow.enabled;
  const global = rows.find((r) => r.scope === "global");
  return global ? global.enabled : FLAGS[key].default;
}

export async function setFlag(key: FlagKey, enabled: boolean | null, scope = "global") {
  if (enabled === null) {
    await prisma.featureFlag.deleteMany({ where: { key, scope } });
    return;
  }
  await prisma.featureFlag.upsert({ where: { key_scope: { key, scope } }, create: { key, scope, enabled }, update: { enabled } });
}

export async function allFlags(scope = "global") {
  const rows = await prisma.featureFlag.findMany({ where: { scope } });
  return (Object.keys(FLAGS) as FlagKey[]).map((k) => {
    const r = rows.find((x) => x.key === k);
    return { key: k, label: FLAGS[k].label, enabled: r ? r.enabled : null, default: FLAGS[k].default };
  });
}
