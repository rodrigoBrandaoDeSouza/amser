import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Field, Flash, Input, LinkButton, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { formatBRL, maskPhone } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import { creditBalance } from "@/lib/scheduling/deposit-policy";
import { prisma } from "@/lib/db";
import { anonymizeCustomerAction, consentAction } from "../../actions-completo";
import { updateCustomerFullAction } from "../../actions-mensagens";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { db, tenant, user } = await requireTenantUser({ permission: "viewCustomers" });
  const { id } = await params;
  const { ok, erro } = await flashParams(searchParams);
  const c = await db.customer.findFirst({
    where: { id, anonymizedAt: null },
    include: { appointments: { include: { service: true, professional: true }, orderBy: { startsAt: "desc" }, take: 50 } },
  });
  if (!c) notFound();
  const credit = await creditBalance(prisma, tenant.id, c.id);
  const consent = (c.consentJson as Record<string, unknown>) ?? {};
  const hasConsent = consent.whatsapp === true && !c.optedOutAt;
  const isOwner = user.role === "owner";
  const stats = {
    visits: c.appointments.filter((a) => a.status === "concluido").length,
    noShows: c.appointments.filter((a) => a.status === "nao_compareceu").length,
    spent: c.appointments.filter((a) => a.status === "concluido").reduce((s, a) => s + a.priceSnapshotCents, 0),
  };

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<>{maskPhone(c.phoneE164)} · cliente desde {c.createdAt.toLocaleDateString("pt-BR")}</>}
        actions={<LinkButton href="/painel/clientes">← Clientes</LinkButton>}
      />
      <Flash ok={ok} erro={erro} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Atendimentos", stats.visits], ["Faltas", stats.noShows], ["Total gasto (estimado)", formatBRL(stats.spent)], ["Crédito disponível", formatBRL(credit)]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="text-xs uppercase text-zinc-500">{l}</div>
            <div className="text-lg font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Histórico">
            <ul className="divide-y divide-zinc-100 text-sm">
              {c.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="capitalize">{formatDateTime(a.startsAt, tenant.timezone)}</span>
                  <span>{a.service.name}</span>
                  <span className="text-zinc-500">· {a.professional.displayName} · {formatBRL(a.priceSnapshotCents)}</span>
                  <span className="ml-auto"><StatusBadge status={a.status} /></span>
                </li>
              ))}
              {!c.appointments.length && <li className="py-2 text-zinc-500">Nenhum agendamento.</li>}
            </ul>
          </Card>
          <Card title="Dados">
            <form action={updateCustomerFullAction.bind(null, c.id)} className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome"><Input name="name" defaultValue={c.name} required /></Field>
              <Field label="WhatsApp" hint="Se mudar, as próximas mensagens vão para o número novo">
                <Input name="phone" inputMode="tel" defaultValue={maskPhone(c.phoneE164)} required />
              </Field>
              <Field label="E-mail"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
              <div className="sm:col-span-2"><Field label="Etiquetas" hint="Separadas por vírgula, ex.: vip, alongamento"><Input name="tags" defaultValue={c.tags.join(", ")} /></Field></div>
              <div className="sm:col-span-2"><Field label="Observações" hint="Preferências e cuidados. Não registre dados de saúde."><Textarea name="notes" rows={3} defaultValue={c.notes ?? ""} maxLength={1000} /></Field></div>
              <div className="sm:col-span-2"><SubmitButton>Salvar</SubmitButton></div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="WhatsApp" actions={hasConsent ? <Badge tone="green">autorizado</Badge> : <Badge>não autorizado</Badge>}>
            <p className="mb-3 text-xs text-zinc-600">
              {hasConsent
                ? `Autorizado em ${consent.whatsappAt ? new Date(String(consent.whatsappAt)).toLocaleString("pt-BR") : "—"} (${String(consent.source ?? "—")}).`
                : c.optedOutAt
                  ? `Pediu para sair em ${c.optedOutAt.toLocaleString("pt-BR")}.`
                  : "Sem autorização para mensagens automáticas."}
            </p>
            {hasConsent ? (
              <form action={consentAction.bind(null, c.id, false)}><Button variant="secondary" type="submit">Parar mensagens automáticas</Button></form>
            ) : (
              <form action={consentAction.bind(null, c.id, true)}>
                <Button variant="secondary" type="submit">Registrar autorização</Button>
                <p className="mt-1 text-xs text-zinc-500">Só se o cliente pediu ou autorizou explicitamente.</p>
              </form>
            )}
          </Card>
          {isOwner && (
            <Card title="Privacidade (LGPD)">
              <a href={`/api/painel/clientes/${c.id}/dados`} className="mb-4 inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">Baixar dados do cliente (JSON)</a>
              <form action={anonymizeCustomerAction.bind(null, c.id)} className="space-y-2 border-t border-zinc-100 pt-4">
                <p className="text-sm text-zinc-600">Exclui nome, telefone, e-mail e observações. O histórico fica anônimo para os seus relatórios. Não dá para desfazer.</p>
                <Field label="Digite EXCLUIR para confirmar"><Input name="confirm" required autoComplete="off" /></Field>
                <SubmitButton variant="danger">Excluir dados pessoais</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
