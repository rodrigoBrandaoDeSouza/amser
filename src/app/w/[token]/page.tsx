import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyWaitlistToken } from "@/lib/waitlist";
import { prisma, tenantDb } from "@/lib/db";
import { publishedTheme } from "@/lib/branding/service";
import { ThemeShell } from "@/components/public/ThemeShell";
import { WaitlistOffer } from "@/components/public/WaitlistOffer";

export const metadata: Metadata = { title: "Abriu um horário", robots: { index: false, follow: false } };

export default async function WaitlistOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claims = await verifyWaitlistToken(token);
  if (!claims) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tid } });
  if (!tenant || tenant.status !== "active") notFound();
  const entry = await tenantDb(tenant.id).waitlistEntry.findFirst({ where: { id: claims.wid }, include: { service: true, customer: true } });
  if (!entry) notFound();
  const theme = await publishedTheme(tenant.id, tenant.name);
  const day = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${entry.date}T12:00:00Z`));
  return (
    <ThemeShell theme={theme}>
      <main className="mx-auto max-w-lg px-4 py-10">
        <p className="pub-muted text-sm">{tenant.name}</p>
        <h1 className="mt-1 text-2xl font-bold">Olá, {entry.customer.name.split(" ")[0]}! Abriu horário.</h1>
        <p className="pub-muted mt-2">
          {entry.service.name} · <span className="capitalize">{day}</span>. Quem reservar primeiro garante a vaga.
        </p>
        <WaitlistOffer token={token} slug={tenant.slug} />
      </main>
    </ThemeShell>
  );
}
