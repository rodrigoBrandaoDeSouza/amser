import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireTenantUser } from "@/lib/auth/session";
import { Card, Flash, PageHeader, Stat, StatusBadge, Button, Badge } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { noShowMetrics, messageUsage, currentPeriod } from "@/lib/metrics";
import { formatBRL, maskPhone } from "@/lib/format";
import { dayBounds } from "@/lib/scheduling/availability";
import { formatTime, localDate } from "@/lib/time";
import { env } from "@/lib/env";
import { markRefundedAction, publishPageAction } from "./actions";

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { user, tenant, db } = await requireTenantUser({ allowStaff: true });
  if (user.role === "staff") redirect("/painel/agenda");
  const { ok, erro } = await flashParams(searchParams);
  const tz = tenant.timezone;
  const today = dayBounds(localDate(new Date(), tz), tz);
  const period = currentPeriod(tz);

  const [todayAppts, metrics, usage, unconfirmed, refunds, checklist] = await Promise.all([
    db.appointment.findMany({
      where: { startsAt: { gte: today.start, lt: today.end }, status: { in: ["aguardando_sinal", "pendente", "confirmado", "concluido", "nao_compareceu"] } },
      include: { customer: true, service: true, professional: true },
      orderBy: { startsAt: "asc" },
    }),
    noShowMetrics(tenant.id, period, tz),
    messageUsage(tenant.id),
    db.appointment.count({ where: { status: "pendente", confirmedPresenceAt: null, presenceDeadlineAt: { lt: new Date() }, startsAt: { gt: new Date() } } }),
    db.payment.findMany({ where: { needsRefund: true, refundedAt: null }, include: { appointment: { include: { customer: true } } } }),
    Promise.all([
      db.tenantBranding.count({ where: { status: "published" } }),
      db.service.count({ where: { active: true, professionals: { some: {} } } }),
      db.workingHour.count(),
      db.whatsappConnection.count({ where: { status: "connected" } }),
    ]),
  ]);
  const [hasTheme, hasServices, hasHours, hasWhatsapp] = checklist.map((n) => n > 0);
  const publicUrl = `${env().APP_URL}/${tenant.slug}`;
  const qr = tenant.status === "active" ? await QRCode.toDataURL(publicUrl, { margin: 1, width: 160 }) : null;
  const usagePct = Math.round(usage.ratio * 100);

  return (
    <>
      <PageHeader title={`Olá, ${user.name.split(" ")[0]}`} subtitle="Resumo do seu negócio" />
      <Flash ok={ok} erro={erro} />

      {tenant.status !== "active" && (
        <Card title="Falta pouco para publicar sua página" className="mb-6 border-amber-200 bg-amber-50/40">
          <ul className="mb-4 space-y-1 text-sm">
            {[
              [hasTheme, "Tema da marca publicado", "/painel/marca"],
              [hasServices, "Serviço ativo com profissional", "/painel/servicos"],
              [hasHours, "Jornada de trabalho definida", "/painel/equipe"],
              [hasWhatsapp, "WhatsApp conectado (recomendado)", "/painel/integracoes"],
            ].map(([done, label, href]) => (
              <li key={String(label)}>
                {done ? "✅" : "⬜"} <Link href={String(href)} className="hover:underline">{String(label)}</Link>
              </li>
            ))}
          </ul>
          <form action={publishPageAction}>
            <Button type="submit" disabled={!hasTheme || !hasServices || !hasHours}>Publicar página</Button>
          </form>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Faltas e sinal — este mês</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Taxa de faltas"
          value={metrics.noShowRate === null ? "—" : `${Math.round(metrics.noShowRate * 100)}%`}
          hint={`${metrics.noShows} faltas em ${metrics.finished} atendimentos`}
        />
        <Stat label="Sinais recebidos" value={formatBRL(metrics.depositsReceivedCents)} />
        <Stat label="Sinais retidos" value={formatBRL(metrics.retainedDepositsCents)} hint="faltas e cancelamentos tardios" />
        <Stat
          label="Horários reaproveitados"
          value={`${metrics.reoccupiedSlots} de ${metrics.releasedSlots}`}
          hint={metrics.reoccupiedValueCents ? `${formatBRL(metrics.reoccupiedValueCents)} reagendados por outros clientes` : "liberados por falta de pagamento/confirmação"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={`Hoje (${todayAppts.length})`} className="lg:col-span-2" actions={<Link href="/painel/agenda" className="text-sm hover:underline">Agenda completa →</Link>}>
          <ul className="divide-y divide-zinc-100">
            {todayAppts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-12 font-semibold tabular-nums">{formatTime(a.startsAt, tz)}</span>
                <span className="font-medium">{a.customer.name}</span>
                <span className="text-zinc-500">{a.service.name} · {a.professional.displayName}</span>
                <span className="ml-auto flex items-center gap-2">
                  {a.confirmedPresenceAt && <Badge tone="green">presença ok</Badge>}
                  <StatusBadge status={a.status} />
                </span>
              </li>
            ))}
            {!todayAppts.length && <li className="py-4 text-sm text-zinc-500">Nenhum agendamento hoje.</li>}
          </ul>
        </Card>

        <div className="space-y-6">
          {(unconfirmed > 0 || refunds.length > 0) && (
            <Card title="Atenção">
              <ul className="space-y-2 text-sm">
                {unconfirmed > 0 && (
                  <li>
                    <Link href="/painel/agenda" className="hover:underline">
                      {unconfirmed} cliente(s) não confirmaram presença no prazo.
                    </Link>
                  </li>
                )}
                {refunds.map((p) => (
                  <li key={p.id}>
                    Reembolsar {formatBRL(p.amountCents)} para {p.appointment.customer.name} ({maskPhone(p.appointment.customer.phoneE164)}) — direto no seu PSP.
                    <form action={markRefundedAction.bind(null, p.id)} className="mt-1"><Button variant="secondary" type="submit">Marcar como reembolsado</Button></form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="WhatsApp do mês">
            <div className="text-sm">
              <div className="mb-1 flex justify-between"><span>{usage.sent} de {usage.quota} mensagens</span><span>{usagePct}%</span></div>
              <div className="h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${usagePct >= 100 ? "bg-red-500" : usagePct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, usagePct)}%` }} /></div>
              {usagePct >= 80 && (
                <p className="mt-2 text-amber-800">
                  {usagePct >= 100 ? "Franquia atingida. As mensagens continuam sendo enviadas; falaremos com você antes de qualquer cobrança extra." : "Você está perto do limite da franquia."}
                </p>
              )}
            </div>
          </Card>
          {qr && (
            <Card title="Link para a bio">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code da sua página" className="mb-2 h-32 w-32" />
              <a href={publicUrl} target="_blank" className="break-all text-sm text-blue-700 underline">{publicUrl}</a>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
