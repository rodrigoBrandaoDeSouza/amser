import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Flash, PageHeader } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { localDate } from "@/lib/time";
import { maskPhone } from "@/lib/format";
import { cancelWaitlistAction } from "../actions-fase2";

const STATUS = {
  waiting: { label: "Aguardando", tone: "blue" },
  offered: { label: "Avisado", tone: "amber" },
  booked: { label: "Reservou", tone: "green" },
  expired: { label: "Expirou", tone: "zinc" },
  cancelled: { label: "Removido", tone: "zinc" },
} as const;

export default async function WaitlistPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const today = localDate(new Date(), tenant.timezone);
  const [entries, booked30] = await Promise.all([
    db.waitlistEntry.findMany({
      where: { date: { gte: today } },
      include: { customer: true, service: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 300,
    }),
    db.waitlistEntry.count({ where: { status: "booked", createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
  ]);
  const pros = await db.professional.findMany({ select: { id: true, displayName: true } });
  const proName = (id: string | null) => (id ? (pros.find((p) => p.id === id)?.displayName ?? "—") : "Qualquer");
  const byDate = new Map<string, typeof entries>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <>
      <PageHeader
        title="Lista de espera"
        subtitle={
          tenant.waitlistEnabled ? (
            <>Quando um horário é liberado (cancelamento, Pix não pago, falta de confirmação), avisamos os primeiros da fila pelo WhatsApp. {booked30} reserva(s) vieram da lista nos últimos 30 dias.</>
          ) : (
            <>A lista de espera está desligada. <Link href="/painel/configuracoes" className="underline">Ativar em Configurações</Link>.</>
          )
        }
      />
      <Flash ok={ok} erro={erro} />
      <div className="space-y-4">
        {[...byDate.entries()].map(([date, list]) => (
          <Card key={date} title={<span className="capitalize">{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</span>}>
            <ul className="divide-y divide-zinc-100 text-sm">
              {list.map((e, i) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-6 text-zinc-400">{i + 1}.</span>
                  <span className="font-medium">{e.customer.name}</span>
                  <span className="text-zinc-500">{maskPhone(e.customer.phoneE164)} · {e.service.name} · {proName(e.professionalId)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}{e.offersCount > 1 ? ` (${e.offersCount}x)` : ""}</Badge>
                    {(e.status === "waiting" || e.status === "offered") && (
                      <form action={cancelWaitlistAction.bind(null, e.id)}><Button variant="ghost" type="submit">Remover</Button></form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        {!entries.length && <Card><p className="text-sm text-zinc-500">Ninguém na lista para os próximos dias.</p></Card>}
      </div>
    </>
  );
}
