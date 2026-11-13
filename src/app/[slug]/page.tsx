import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicTenant } from "@/lib/public";
import { publishedTheme } from "@/lib/branding/service";
import { TenantPublicPage } from "@/components/public/TenantPublicPage";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await getPublicTenant((await params).slug);
  if (!tenant) return { title: "Página não encontrada" };
  const theme = await publishedTheme(tenant.id, tenant.name);
  const image = theme.heroMediaId ? `${env().APP_URL}/api/media/${theme.heroMediaId}` : undefined;
  // Com domínio próprio verificado, ele é o endereço canônico (SEO).
  const domain = await prisma.tenantDomain.findFirst({ where: { tenantId: tenant.id, verifiedAt: { not: null } }, orderBy: { createdAt: "asc" } });
  return {
    title: `${tenant.name} — agende online`,
    description: theme.copy.description || `Agende seu horário com ${tenant.name}.`,
    alternates: { canonical: domain ? `https://${domain.hostname}/` : `/${tenant.slug}` },
    openGraph: { title: tenant.name, description: theme.copy.description, type: "website", locale: "pt_BR", images: image ? [image] : undefined },
  };
}

export default async function TenantPublicRoute({ params }: Props) {
  const tenant = await getPublicTenant((await params).slug);
  if (!tenant) notFound();
  return <TenantPublicPage tenant={tenant} />;
}
