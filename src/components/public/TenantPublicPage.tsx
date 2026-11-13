import type { Tenant } from "@prisma/client";
import { getPublicCatalog, getPublicUnits, cancellationPolicy } from "@/lib/public";
import { publishedTheme } from "@/lib/branding/service";
import { tenantDb } from "@/lib/db";
import { PublicPage } from "./PublicPage";

/** Página pública de uma empresa publicada (usada por /{slug} e por domínio próprio). */
export async function TenantPublicPage({ tenant }: { tenant: Tenant }) {
  const [theme, services, units, logo] = await Promise.all([
    publishedTheme(tenant.id, tenant.name),
    getPublicCatalog(tenant.id),
    getPublicUnits(tenant.id),
    tenantDb(tenant.id).tenantMedia.findFirst({ where: { kind: "logo", rightsConfirmed: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <PublicPage tenant={tenant} theme={theme} services={services} units={units} policy={cancellationPolicy(tenant)} mode="live" logoMediaId={logo?.id} />
  );
}
