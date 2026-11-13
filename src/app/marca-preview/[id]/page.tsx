import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/session";
import { ThemeSchema } from "@/lib/branding/theme";
import { getPublicCatalog, cancellationPolicy } from "@/lib/public";
import { PublicPage } from "@/components/public/PublicPage";

export const metadata = { robots: { index: false } };

/** Prévia de uma versão do tema, só para o dono (iframe do editor de marca). */
export default async function BrandPreview({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, db } = await requireTenantUser();
  const { id } = await params;
  const version = await db.tenantBranding.findFirst({ where: { id } });
  const theme = version ? ThemeSchema.safeParse(version.themeJson) : null;
  if (!theme?.success) notFound();
  const [services, logo] = await Promise.all([
    getPublicCatalog(tenant.id),
    db.tenantMedia.findFirst({ where: { kind: "logo" }, orderBy: { createdAt: "desc" } }),
  ]);
  return <PublicPage tenant={tenant} theme={theme.data} services={services} policy={cancellationPolicy(tenant)} mode="preview" logoMediaId={logo?.id} />;
}
