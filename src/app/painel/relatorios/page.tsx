import { requireTenantUser } from "@/lib/auth/session";
import { Button, Card, Field, Input, PageHeader, Select, Stat } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { buildReport } from "@/lib/reports";
import { formatBRL } from "@/lib/format";
import { addDays, isValidDate, localDate } from "@/lib/time";

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db, user, professional } = await requireTenantUser({ permission: "viewReports" });
  const { get } = await flashParams(searchParams);
  const today = localDate(new Date(), tenant.timezone);
  const from = isValidDate(get("de") ?? "") ? get("de")! : `${today.slice(0, 7)}-01`;
  const to = isValidDate(get("ate") ?? "") && get("ate")! >= from ? get("ate")! : today;
  const pros = await db.professional.findMany({ orderBy: { displayName: "asc" } });
  // Staff sem "ver todas as agendas" só vê os próprios números.
  const canAll = user.role === "owner" || (user.permissionsJson as Record<string, unknown>)?.viewAllAgendas === true;
  const proFilter = canAll ? (pros.some((p) => p.id === get("profissional")) ? get("profissional")! : null) : (professional?.id ?? "none");
  const r = await buildReport(tenant.id, from, to, tenant.timezone, proFilter);
  const maxWd = Math.max(1, ...r.byWeekday);
  const presets = [
    ["Este mês", `${today.slice(0, 7)}-01`, today],
    ["Últimos 30 dias", addDays(today, -29), today],
    ["Últimos 90 dias", addDays(today, -89), today],
  ];

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Faturamento estimado pelos atendimentos concluídos — não é o que entrou no caixa."
        actions={
          user.role === "owner" ? (
            <a href={`/api/painel/relatorios/csv?de=${from}&ate=${to}`} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">Exportar agendamentos (CSV)</a>
          ) : undefined
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-2">
        <Field label="De"><Input type="date" name="de" defaultValue={from} /></Field>
        <Field label="Até"><Input type="date" name="ate" defaultValue={to} /></Field>
        {canAll && (
          <Field label="Profissional">
            <Select name="profissional" defaultValue={proFilter ?? ""}>
              <option value="">Todos</option>
              {pros.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </Select>
          </Field>
        )}
        <Button variant="secondary" type="submit">Aplicar</Button>
        <div className="flex gap-2 text-xs">
          {presets.map(([l, a, b]) => <a key={l} href={`?de=${a}&ate=${b}`} className="rounded-full border bg-white px-2 py-1">{l}</a>)}
        </div>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faturamento estimado" value={formatBRL(r.revenueEstimatedCents)} hint={`${r.byStatus.concluido ?? 0} concluídos · ticket ${r.ticketCents ? formatBRL(r.ticketCents) : "—"}`} />
        <Stat label="A realizar no período" value={formatBRL(r.revenueExpectedCents)} hint={`${(r.byStatus.pendente ?? 0) + (r.byStatus.confirmado ?? 0)} agendamentos`} />
        <Stat label="Faltas" value={pct(r.noShowRate)} hint={`${r.byStatus.nao_compareceu ?? 0} faltas · cancelamentos ${pct(r.cancelRate)}`} />
        <Stat label="Sinais" value={formatBRL(r.deposits.receivedCents)} hint={`retidos ${formatBRL(r.deposits.retainedCents)} · devolvidos ${formatBRL(r.deposits.refundedCents)} · crédito ${formatBRL(r.deposits.creditedCents)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Por serviço">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="text-left">Serviço</th><th className="text-right">Agend.</th><th className="text-right">Faturamento</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {r.byService.map((s) => <tr key={s.name}><td className="py-1.5">{s.name}</td><td className="text-right tabular-nums">{s.count}</td><td className="text-right tabular-nums">{formatBRL(s.revenueCents)}</td></tr>)}
              {!r.byService.length && <tr><td colSpan={3} className="py-3 text-zinc-500">Sem dados no período.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Por profissional">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="text-left">Profissional</th><th className="text-right">Agend.</th><th className="text-right">Faltas</th><th className="text-right">Faturamento</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {r.byProfessional.map((p) => <tr key={p.name}><td className="py-1.5">{p.name}</td><td className="text-right tabular-nums">{p.count}</td><td className="text-right tabular-nums">{p.noShows}</td><td className="text-right tabular-nums">{formatBRL(p.revenueCents)}</td></tr>)}
              {!r.byProfessional.length && <tr><td colSpan={4} className="py-3 text-zinc-500">Sem dados no período.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Movimento por dia da semana">
          <div className="flex h-36 items-end gap-2" role="img" aria-label={`Agendamentos por dia da semana: ${r.byWeekday.map((n, i) => `${WD[i]} ${n}`).join(", ")}`}>
            {r.byWeekday.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs tabular-nums text-zinc-600">{n}</span>
                <div className="w-full rounded-t bg-zinc-800" style={{ height: `${(n / maxWd) * 100}px` }} />
                <span className="text-xs text-zinc-500">{WD[i]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Origem e clientes">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-zinc-500">Pela página</dt><dd className="text-lg font-semibold">{r.bySource.public}</dd></div>
            <div><dt className="text-zinc-500">Pela recepção</dt><dd className="text-lg font-semibold">{r.bySource.manual}</dd></div>
            <div><dt className="text-zinc-500">Clientes novos</dt><dd className="text-lg font-semibold">{r.newCustomers}</dd></div>
            <div><dt className="text-zinc-500">Descontos (cupons)</dt><dd className="text-lg font-semibold">{formatBRL(r.discountsCents)}</dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}
