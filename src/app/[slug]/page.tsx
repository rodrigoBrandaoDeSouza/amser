import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicTenant, getPublicCatalog, cancellationPolicy } from "@/lib/public";
import { publishedTheme } from "@/lib/branding/service";
import { tenantDb } from "@/lib/db";
import { PublicPage } from "@/components/public/PublicPage";
import { env } from "@/lib/env";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await getPublicTenant((await params).slug);
  if (!tenant) return { title: "Página não encontrada" };
  const theme = await publishedTheme(tenant.id, tenant.name);
  const image = theme.heroMediaId ? `${env().APP_URL}/api/media/${theme.heroMediaId}` : undefined;
  return {
    title: `${tenant.name} — agende online`,
    description: theme.copy.description || `Agende seu horário com ${tenant.name}.`,
    alternates: { canonical: `/${tenant.slug}` },
    openGraph: {
      title: tenant.name,
      description: theme.copy.description,
      type: "website",
      locale: "pt_BR",
      images: image ? [image] : undefined,
    },
  };
}

export default async function TenantPublicPage({ params }: Props) {
  const tenant = await getPublicTenant((await params).slug);
  if (!tenant) notFound();
  const [theme, services, logo] = await Promise.all([
    publishedTheme(tenant.id, tenant.name),
    getPublicCatalog(tenant.id),
    tenantDb(tenant.id).tenantMedia.findFirst({ where: { kind: "logo", rightsConfirmed: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return <PublicPage tenant={tenant} theme={theme} services={services} policy={cancellationPolicy(tenant)} mode="live" logoMediaId={logo?.id} />;
}
