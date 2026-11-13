import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantByHost } from "@/lib/domains";
import { publishedTheme } from "@/lib/branding/service";
import { TenantPublicPage } from "@/components/public/TenantPublicPage";

type Props = { params: Promise<{ host: string }> };

/** Domínio próprio (Fase 2): o middleware reescreve "/" do domínio do cliente para cá. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent((await params).host);
  const tenant = await tenantByHost(host);
  if (!tenant) return { title: "Página não encontrada" };
  const theme = await publishedTheme(tenant.id, tenant.name);
  return {
    title: `${tenant.name} — agende online`,
    description: theme.copy.description || `Agende seu horário com ${tenant.name}.`,
    alternates: { canonical: `https://${host}/` },
  };
}

export default async function CustomDomainPage({ params }: Props) {
  const tenant = await tenantByHost(decodeURIComponent((await params).host));
  if (!tenant) notFound();
  return <TenantPublicPage tenant={tenant} />;
}
