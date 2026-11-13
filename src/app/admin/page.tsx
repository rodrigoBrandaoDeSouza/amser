import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Card, Flash, LinkButton, PageHeader, Stat } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { mrrCents } from "@/lib/billing/service";
import { formatBRL } from "@/lib/format";

const STATUS_TONE = { prospect: "amber", onboarding: "blue", active: "green", suspended: "red", deleted: "zinc" } as const;
const STATUS_TEXT = { prospect: "Prévia", onboarding: "Onboarding", active: "Ativa", suspended: "Suspensa", deleted: "Excluída" };

export default async function AdminHome({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erro } = await flashParams(searchParams);
  const since = new Date(Date.now() - 30 * 86400_000);
  const period = new Date().toISOString().slice(0, 7);
  const [tenants, byStatus, converted, prospectsCreated, appts30, usage, dead] = await Promise.all([
    prisma.tenant.findMany({
      where: { status: { not: "deleted" } },
      orderBy: { createdAt: "desc" },
      include: { plan: true, _count: { select: { appointments: true } } },
      take: 200,
    }),
    prisma.tenant.groupBy({ by: ["status"], _count: true }),
    prisma.auditLog.count({ where: { action: "prospect.convert", createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "tenant.create.prospect", createdAt: { gte: since } } }),
    prisma.appointment.count({ where: { createdAt: { gte: since } } }),
    prisma.messageUsage.aggregate({ where: { period }, _sum: { messagesSent: true } }),
    prisma.messageOutbox.count({ where: { status: "dead", createdAt: { gte: since } } }),
  ]);
  const [mrr, subs, selfSignups] = await Promise.all([
    mrrCents(),
    prisma.subscription.groupBy({ by: ["status"], _count: true }),
    prisma.auditLog.count({ where: { action: "tenant.create.onboarding", actorId: "self-signup", createdAt: { gte: since } } }),
  ]);
  const subCount = (s: string) => subs.find((b) => b.status === s)?._count ?? 0;
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Visão geral da plataforma"
        actions={
          <div className="flex gap-2">
            <LinkButton href="/admin/prospects/novo" variant="primary">Gerar prévia</LinkButton>
            <LinkButton href="/admin/empresas/nova">Nova empresa</LinkButton>
          </div>
        }
      />
      <Flash ok={ok} erro={erro} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ativas" value={count("active")} hint={`${count("onboarding")} em onboarding`} />
        <Stat label="Prévias abertas" value={count("prospect")} />
        <Stat label="Conversão (30d)" value={prospectsCreated ? `${Math.round((converted / prospectsCreated) * 100)}%` : "—"} hint={`${converted} de ${prospectsCreated} prévias`} />
        <Stat label="Agendamentos (30d)" value={appts30} />
        <Stat label="WhatsApp no mês" value={usage._sum.messagesSent ?? 0} hint={dead ? `${dead} falhas definitivas (30d)` : "sem falhas definitivas"} />
        <Stat label="MRR" value={formatBRL(mrr)} hint={`${subCount("active")} assinaturas pagas`} />
        <Stat label="Em teste" value={subCount("trialing")} hint={`${selfSignups} cadastros self-service (30d)`} />
        <Stat label="Inadimplentes" value={subCount("past_due")} hint={`${count("suspended")} empresas suspensas`} />
      </div>
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2 sm:px-2">Empresa</th>
                <th className="px-2 py-2">Segmento</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Plano</th>
                <th className="px-2 py-2 text-right">Agendamentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 sm:px-2">
                    <Link href={`/admin/empresas/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                    <div className="text-xs text-zinc-500">/{t.slug}</div>
                  </td>
                  <td className="px-2 py-2 capitalize">{t.segment}</td>
                  <td className="px-2 py-2"><Badge tone={STATUS_TONE[t.status]}>{STATUS_TEXT[t.status]}</Badge></td>
                  <td className="px-2 py-2">{t.plan?.name ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t._count.appointments}</td>
                </tr>
              ))}
              {!tenants.length && (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-zinc-500">Nenhuma empresa ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
