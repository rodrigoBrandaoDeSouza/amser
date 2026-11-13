import QRCode from "qrcode";
import { requireTenantUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Badge, Card, Flash, PageHeader, Stat } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { formatBRL } from "@/lib/format";
import { planLimits } from "@/lib/plans";
import { messageUsage } from "@/lib/metrics";
import { env } from "@/lib/env";
import { DevPayInvoice } from "./DevPayInvoice";

const SUB_STATUS = {
  trialing: { label: "Teste grátis", tone: "blue" },
  active: { label: "Ativa", tone: "green" },
  past_due: { label: "Pagamento pendente", tone: "amber" },
  canceled: { label: "Cancelada", tone: "red" },
} as const;

export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser({ allowBillingSuspended: true });
  const { ok, erro } = await flashParams(searchParams);
  const [sub, invoices, limits, usage, pros, units, plans] = await Promise.all([
    prisma.subscription.findFirst({ where: { tenantId: tenant.id }, include: { plan: true }, orderBy: { periodEnd: "desc" } }),
    db.billingInvoice.findMany({ orderBy: { dueAt: "desc" }, take: 12 }),
    planLimits(tenant),
    messageUsage(tenant.id),
    db.professional.count({ where: { active: true } }),
    db.unit.count({ where: { active: true } }),
    prisma.plan.findMany({ orderBy: { priceCents: "asc" } }),
  ]);
  const open = invoices.find((i) => i.status === "open");
  const qr = open?.pixCopyPaste ? await QRCode.toDataURL(open.pixCopyPaste, { margin: 1, width: 200 }) : null;
  const lim = (n: number) => (Number.isFinite(n) ? n : "∞");

  return (
    <>
      <PageHeader title="Plano e cobrança" subtitle="Sem comissão por cliente. WhatsApp incluído na franquia do plano." />
      <Flash ok={ok} erro={erro} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plano" value={sub?.plan.name ?? "—"} hint={sub ? `${formatBRL(sub.plan.priceCents)}/mês` : undefined} />
        <Stat
          label="Situação"
          value={sub ? <Badge tone={SUB_STATUS[sub.status].tone}>{SUB_STATUS[sub.status].label}</Badge> : "—"}
          hint={sub?.status === "trialing" ? `até ${sub.trialEndsAt?.toLocaleDateString("pt-BR")}` : sub ? `período até ${sub.periodEnd.toLocaleDateString("pt-BR")}` : undefined}
        />
        <Stat label="Profissionais" value={`${pros} / ${lim(limits.professionals)}`} />
        <Stat label="WhatsApp no mês" value={`${usage.sent} / ${usage.quota}`} hint={`unidades: ${units} / ${lim(limits.units)}`} />
      </div>

      {open && (
        <Card title={`Fatura em aberto — ${formatBRL(open.amountCents)}`} className="mb-6 border-amber-200">
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt="QR code do Pix da fatura" className="h-40 w-40 rounded border" />}
            <div className="min-w-0 space-y-2 text-sm">
              <p>Vencimento: {open.dueAt.toLocaleDateString("pt-BR")} · período {open.periodStart.toLocaleDateString("pt-BR")} a {open.periodEnd.toLocaleDateString("pt-BR")}</p>
              {open.pixCopyPaste && <p className="break-all rounded bg-zinc-50 p-2 font-mono text-xs">{open.pixCopyPaste}</p>}
              {env().NODE_ENV !== "production" && env().BILLING_PROVIDER === "mock" && <DevPayInvoice />}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Faturas">
          <ul className="divide-y divide-zinc-100 text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <span>{i.periodStart.toLocaleDateString("pt-BR")} a {i.periodEnd.toLocaleDateString("pt-BR")}</span>
                <span className="font-medium tabular-nums">{formatBRL(i.amountCents)}</span>
                <span className="ml-auto"><Badge tone={i.status === "paid" ? "green" : i.status === "open" ? "amber" : "zinc"}>{i.status === "paid" ? `paga ${i.paidAt?.toLocaleDateString("pt-BR")}` : i.status === "open" ? "em aberto" : "cancelada"}</Badge></span>
              </li>
            ))}
            {!invoices.length && <li className="py-2 text-zinc-500">Nenhuma fatura ainda. A primeira é gerada 5 dias antes do fim do teste.</li>}
          </ul>
        </Card>
        <Card title="Planos disponíveis">
          <ul className="space-y-2 text-sm">
            {plans.map((p) => {
              const l = (p.limitsJson ?? {}) as { professionals?: number; units?: number };
              return (
                <li key={p.id} className={`rounded-lg border p-3 ${p.id === sub?.planId ? "border-zinc-900" : "border-zinc-200"}`}>
                  <div className="flex justify-between font-medium"><span>{p.name}</span><span>{formatBRL(p.priceCents)}/mês</span></div>
                  <div className="text-zinc-600">{l.professionals ?? "∞"} profissional(is) · {l.units ?? 1} unidade(s) · {p.messageQuota} mensagens de WhatsApp/mês</div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">Para trocar de plano, fale com a gente pelo WhatsApp. A mudança vale a partir da próxima fatura.</p>
        </Card>
      </div>
    </>
  );
}
