import Link from "next/link";
import { tenantDb } from "@/lib/db";
import { Card, PageHeader, STATUS_LABEL } from "@/components/ui";
import { dayBounds } from "@/lib/scheduling/availability";
import { addDays, formatTime, weekdayOf } from "@/lib/time";

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TONE: Record<string, string> = {
  aguardando_sinal: "border-amber-300 bg-amber-50",
  pendente: "border-blue-200 bg-blue-50",
  confirmado: "border-emerald-300 bg-emerald-50",
  concluido: "border-zinc-200 bg-zinc-50 text-zinc-500",
  nao_compareceu: "border-red-200 bg-red-50 text-red-800",
  cancelado: "border-zinc-200 bg-white text-zinc-400 line-through",
};

/** Agenda semanal (§12): 7 colunas, segunda a domingo, com todos os profissionais filtrados. */
export async function WeekAgenda(props: { tenantId: string; tz: string; date: string; onlyPro?: string; unitFilter: string | null; title: string }) {
  const { tz, date, onlyPro, unitFilter } = props;
  const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const start = dayBounds(days[0], tz).start;
  const end = dayBounds(days[6], tz).end;
  const db = tenantDb(props.tenantId);
  const [pros, appts, blocks] = await Promise.all([
    db.professional.findMany({ where: { active: true, ...(onlyPro ? { id: onlyPro } : {}), ...(unitFilter ? { unitId: unitFilter } : {}) }, orderBy: { displayName: "asc" } }),
    db.appointment.findMany({
      where: { startsAt: { gte: start, lt: end }, status: { notIn: ["expirado"] }, ...(onlyPro ? { professionalId: onlyPro } : {}), ...(unitFilter ? { unitId: unitFilter } : {}) },
      include: { customer: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.scheduleException.findMany({ where: { startsAt: { lt: end }, endsAt: { gt: start } } }),
  ]);
  const proName = new Map(pros.map((p) => [p.id, p.displayName]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const range = `${new Date(`${days[0]}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })} a ${new Date(`${days[6]}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`;
  const q = (d: string) => `/painel/agenda?visao=semana&data=${d}${unitFilter ? `&unidade=${unitFilter}` : ""}`;
  const active = appts.filter((a) => a.status !== "cancelado").length;

  return (
    <>
      <PageHeader
        title={props.title}
        subtitle={`${range} · ${active} agendamento(s)`}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link className="rounded-lg border bg-white px-3 py-2" href={q(addDays(monday, -7))}>←</Link>
            <Link className="rounded-lg border bg-white px-3 py-2" href={q(today)}>Esta semana</Link>
            <Link className="rounded-lg border bg-white px-3 py-2" href={q(addDays(monday, 7))}>→</Link>
          </div>
        }
      />
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <div className="grid min-w-[900px] grid-cols-7 gap-2">
            {days.map((d) => {
              const b = dayBounds(d, tz);
              const list = appts.filter((a) => a.startsAt >= b.start && a.startsAt < b.end);
              const dayBlocks = blocks.filter((x) => x.startsAt < b.end && x.endsAt > b.start && (!x.professionalId || proName.has(x.professionalId)));
              return (
                <div key={d} className={`min-h-48 rounded-lg border p-2 ${d === today ? "border-zinc-900" : "border-zinc-200"}`}>
                  <Link href={`/painel/agenda?data=${d}${unitFilter ? `&unidade=${unitFilter}` : ""}`} className="mb-2 block text-xs font-semibold hover:underline">
                    {WD[weekdayOf(d)]} {d.slice(8)}/{d.slice(5, 7)}
                  </Link>
                  {dayBlocks.map((x) => (
                    <div key={x.id} className="mb-1 rounded bg-zinc-100 px-1.5 py-1 text-[11px] text-zinc-600">
                      🚫 {formatTime(x.startsAt, tz)}–{formatTime(x.endsAt, tz)} {x.professionalId ? proName.get(x.professionalId) : "todos"}
                    </div>
                  ))}
                  <ul className="space-y-1">
                    {list.map((a) => (
                      <li key={a.id} className={`rounded border px-1.5 py-1 text-[11px] leading-tight ${TONE[a.status] ?? ""}`} title={STATUS_LABEL[a.status]?.label}>
                        <div className="font-semibold tabular-nums">{formatTime(a.startsAt, tz)} {a.customer.name.split(" ")[0]}</div>
                        <div className="truncate">{a.service.name}</div>
                        {!onlyPro && pros.length > 1 && <div className="truncate opacity-70">{proName.get(a.professionalId)}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
