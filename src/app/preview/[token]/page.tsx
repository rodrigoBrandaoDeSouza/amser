import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, tenantDb } from "@/lib/db";
import { latestTheme } from "@/lib/branding/service";
import { getPublicCatalog, cancellationPolicy } from "@/lib/public";
import { PublicPage } from "@/components/public/PublicPage";

export const metadata: Metadata = { title: "Prévia", robots: { index: false, follow: false } };

/** Prévia para prospect (§4.1): acessível só por token, não indexável, expira. */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { previewToken: token } });
  if (!tenant || tenant.status !== "prospect" || !tenant.previewExpiresAt || tenant.previewExpiresAt < new Date()) notFound();
  const [theme, services, logo] = await Promise.all([
    latestTheme(tenant.id, tenant.name),
    getPublicCatalog(tenant.id),
    tenantDb(tenant.id).tenantMedia.findFirst({ where: { kind: "logo" }, orderBy: { createdAt: "desc" } }),
  ]);
  return <PublicPage tenant={tenant} theme={theme} services={services} policy={cancellationPolicy(tenant)} mode="preview" logoMediaId={logo?.id} />;
}
