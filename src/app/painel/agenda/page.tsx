import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { dayBounds } from "@/lib/scheduling/availability";
import { addDays, formatTime, isValidDate, localDate } from "@/lib/time";
import { formatBRL, maskPhone } from "@/lib/format";
import { appointmentAction, blockTimeAction, deleteBlockAction, manualBookingAction, rescheduleStaffAction } from "../actions";

export default async function AgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, tenant, db, professional } = await requireTenantUser({ allowStaff: true });
  const { ok, erro, get } = await flashParams(searchParams);
  const tz = tenant.timezone;
  const today = localDate(new Date(), tz);
  const date = isValidDate(get("data") ?? "") ? get("data")! : today;
  const bounds = dayBounds(date, tz);
  const back = `/painel/agenda?data=${date}`;
  const onlyPro = professional?.id;

  const [pros, appts, blocks, services] = await Promise.all([
    db.professional.findMany({ where: { active: true, ...(onlyPro ? { id: onlyPro } : {}) }, orderBy: { displayName: "asc" } }),
    db.appointment.findMany({
      where: {
        startsAt: { gte: bounds.start, lt: bounds.end },
        status: { notIn: ["expirado"] },
        ...(onlyPro ? { professionalId: onlyPro } : {}),
      },
      include: { customer: true, service: true, payments: true },
      orderBy: { startsAt: "asc" },
    }),
    db.scheduleException.findMany({
      where: {
        startsAt: { lt: bounds.end },
        endsAt: { gt: bounds.start },
        ...(onlyPro ? { OR: [{ professionalId: onlyPro }, { professionalId: null }] } : {}),
      },
      include: { professional: true },
    }),
    db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const dayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  return (
    <>
      <PageHeader
        title={user.role === "staff" ? "Minha agenda" : "Agenda"}
        subtitle={<span className="capitalize">{dayLabel}</span>}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link className="rounded-lg border bg-white px-3 py-2" href={`/painel/agenda?data=${addDays(date, -1)}`}>←</Link>
            <Link className="rounded-lg border bg-white px-3 py-2" href={`/painel/agenda?data=${today}`}>Hoje</Link>
            <Link className="rounded-lg border bg-white px-3 py-2" href={`/painel/agenda?data=${addDays(date, 1)}`}>→</Link>
            <form className="flex gap-1">
              <Input type="date" name="data" defaultValue={date} className="w-40" />
              <Button variant="secondary" type="submit">Ir</Button>
            </form>
          </div>
        }
      />
      <Flash ok={ok} erro={erro} />

      <div className="grid gap-4 lg:grid-cols-2">
        {pros.map((p) => {
          const list = appts.filter((a) => a.professionalId === p.id);
          const pBlocks = blocks.filter((b) => !b.professionalId || b.professionalId === p.id);
          return (
            <Card key={p.id} title={p.displayName} actions={<span className="text-xs text-zinc-500">{list.filter((a) => a.status !== "cancelado").length} agendamento(s)</span>}>
              {pBlocks.map((b) => (
                <div key={b.id} className="mb-2 flex items-center justify-between rounded bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700">
                  <span>
                    🚫 {formatTime(b.startsAt, tz)}–{formatTime(b.endsAt, tz)} · {b.type === "holiday" ? "Feriado" : b.type === "vacation" ? "Férias" : "Bloqueio"}
                    {b.reason ? ` · ${b.reason}` : ""}
                  </span>
                  {user.role === "owner" && (
                    <form action={deleteBlockAction.bind(null, b.id, back)}><button className="underline">remover</button></form>
                  )}
                </div>
              ))}
              <ul className="divide-y divide-zinc-100">
                {list.map((a) => {
                  const active = a.status === "pendente" || a.status === "confirmado";
                  const paid = a.payments.find((x) => ["paid", "applied", "retained"].includes(x.status));
                  return (
                    <li key={a.id} className={`py-3 text-sm ${a.status === "cancelado" ? "opacity-50" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatTime(a.startsAt, tz)}–{formatTime(a.endsAt, tz)}</span>
                        <StatusBadge status={a.status} />
                        {a.confirmedPresenceAt && <Badge tone="green">presença confirmada</Badge>}
                        {a.status === "pendente" && !a.confirmedPresenceAt && a.presenceDeadlineAt && a.presenceDeadlineAt < new Date() && <Badge tone="amber">não confirmou</Badge>}
                        {paid && <Badge tone="blue">sinal {formatBRL(paid.amountCents)}</Badge>}
                        {a.source === "manual" && <Badge>manual</Badge>}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium">{a.customer.name}</span>{" "}
                        <a className="text-zinc-500 hover:underline" href={`https://wa.me/${a.customer.phoneE164.replace("+", "")}`} target="_blank" rel="noopener noreferrer">
                          {maskPhone(a.customer.phoneE164)}
                        </a>
                        <span className="text-zinc-500"> · {a.service.name} · {formatBRL(a.priceSnapshotCents)}</span>
                      </div>
                      {active && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <form action={appointmentAction.bind(null, a.id, "concluido", back)}><Button variant="secondary" type="submit">Concluído</Button></form>
                          <form action={appointmentAction.bind(null, a.id, "nao_compareceu", back)}><Button variant="secondary" type="submit">Faltou</Button></form>
                          {!a.confirmedPresenceAt && <form action={appointmentAction.bind(null, a.id, "confirmar", back)}><Button variant="ghost" type="submit">Confirmar presença</Button></form>}
                          <form action={appointmentAction.bind(null, a.id, "cancelar", back)}><Button variant="danger" type="submit">Cancelar</Button></form>
                          <details className="w-full">
                            <summary className="cursor-pointer text-xs text-zinc-600">Remarcar</summary>
                            <form action={rescheduleStaffAction.bind(null, a.id, back)} className="mt-2 flex flex-wrap gap-2">
                              <Input type="date" name="date" defaultValue={date} className="w-40" required />
                              <Input type="time" name="time" step={300} className="w-28" required />
                              <SubmitButton variant="secondary">Remarcar</SubmitButton>
                            </form>
                          </details>
                        </div>
                      )}
                    </li>
                  );
                })}
                {!list.length && <li className="py-4 text-sm text-zinc-500">Livre.</li>}
              </ul>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Agendamento manual (recepção)">
          <form action={manualBookingAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Serviço">
              <Select name="serviceId" required>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>)}
              </Select>
            </Field>
            <Field label="Profissional">
              <Select name="professionalId" defaultValue={onlyPro ?? ""}>
                {!onlyPro && <option value="">Qualquer disponível</option>}
                {pros.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </Select>
            </Field>
            <Field label="Data"><Input type="date" name="date" defaultValue={date} required /></Field>
            <Field label="Horário"><Input type="time" name="time" step={300} required /></Field>
            <Field label="Nome do cliente"><Input name="name" required /></Field>
            <Field label="WhatsApp"><Input name="phone" inputMode="tel" required /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consent" defaultChecked /> Cliente aceita lembretes no WhatsApp</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="skipDeposit" defaultChecked /> Sem sinal (pago no balcão)</label>
            <div className="sm:col-span-2"><SubmitButton>Agendar</SubmitButton></div>
          </form>
        </Card>
        <Card title="Bloquear horário">
          <form action={blockTimeAction} className="grid gap-3 sm:grid-cols-2">
            {!onlyPro && (
              <Field label="Profissional">
                <Select name="professionalId">
                  <option value="">Todos (ex.: feriado)</option>
                  {pros.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Tipo">
              <Select name="type">
                <option value="block">Bloqueio</option>
                <option value="vacation">Férias</option>
                <option value="holiday">Feriado</option>
              </Select>
            </Field>
            <Field label="Data"><Input type="date" name="date" defaultValue={date} required /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="De"><Input type="time" name="start" defaultValue="00:00" /></Field>
              <Field label="Até"><Input type="time" name="end" defaultValue="23:59" /></Field>
            </div>
            <Field label="Motivo (opcional)"><Input name="reason" maxLength={120} /></Field>
            <div className="sm:col-span-2"><SubmitButton variant="secondary">Bloquear</SubmitButton></div>
          </form>
        </Card>
      </div>
    </>
  );
}
