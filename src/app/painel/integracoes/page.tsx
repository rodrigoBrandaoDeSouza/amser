import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { messageUsage } from "@/lib/metrics";
import { maskPhone } from "@/lib/format";
import { env } from "@/lib/env";
import { saveTemplatesAction, saveWhatsappAction } from "../actions";

const EVENTS = [
  ["booking_confirmed", "Confirmação de agendamento"],
  ["payment_pending", "Pix pendente"],
  ["reminder", "Lembrete"],
  ["presence_request", "Pedido de confirmação de presença"],
  ["rescheduled", "Remarcação"],
  ["cancelled", "Cancelamento"],
] as const;

const OUT_TONE = { pending: "amber", sent: "blue", delivered: "green", read: "green", failed: "red", dead: "red", skipped: "zinc" } as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const [conn, templates, outbox, usage, pix] = await Promise.all([
    db.whatsappConnection.findFirst({}),
    db.messageTemplate.findMany({}),
    db.messageOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    messageUsage(tenant.id),
    db.paymentConnection.findFirst({}),
  ]);
  const tpl = (ev: string) => templates.find((t) => t.eventType === ev);
  const mock = env().WHATSAPP_PROVIDER === "mock";

  return (
    <>
      <PageHeader title="Integrações" subtitle="WhatsApp oficial (Meta Cloud API) e Pix" />
      <Flash ok={ok} erro={erro} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="WhatsApp"
          actions={<Badge tone={conn?.status === "connected" ? "green" : "amber"}>{conn?.status === "connected" ? "conectado" : mock ? "modo de teste" : "não conectado"}</Badge>}
        >
          <p className="mb-4 text-sm text-zinc-600">
            Use o número do seu negócio na WhatsApp Business Platform. Mensagens automáticas usam templates aprovados pela Meta.
            Incluído no seu plano: {usage.quota} mensagens/mês (usadas: {usage.sent}).
          </p>
          <form action={saveWhatsappAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone Number ID"><Input name="phoneNumberId" defaultValue={conn?.phoneNumberId ?? ""} /></Field>
            <Field label="Número exibido"><Input name="displayPhone" defaultValue={conn?.displayPhone ?? ""} placeholder="+55 11 9…" /></Field>
            <div className="sm:col-span-2">
              <Field label="Token de acesso" hint={conn?.encryptedCredentials ? "Já configurado. Preencha só para substituir." : "Guardado criptografado. Nunca é exibido de volta."}>
                <Input name="accessToken" type="password" autoComplete="off" />
              </Field>
            </div>
            <Field label="Enviar lembretes a partir de"><Input type="time" name="sendWindowStart" defaultValue={conn?.sendWindowStart ?? "08:00"} /></Field>
            <Field label="Até"><Input type="time" name="sendWindowEnd" defaultValue={conn?.sendWindowEnd ?? "21:00"} /></Field>
            <div className="sm:col-span-2"><SubmitButton>Salvar WhatsApp</SubmitButton></div>
          </form>
        </Card>

        <Card title="Templates aprovados">
          <p className="mb-3 text-sm text-zinc-600">
            Nome do template aprovado na Meta para cada evento. Variáveis do corpo: {"{{1}}"} nome do cliente, {"{{2}}"} serviço, {"{{3}}"} data/hora,
            {" {{4}}"} nome do negócio. Botão de URL: <code className="text-xs">{env().APP_URL}/a/{"{{1}}"}</code>.
          </p>
          <form action={saveTemplatesAction} className="space-y-2">
            {EVENTS.map(([ev, label]) => (
              <div key={ev} className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label={label}><Input name={`tpl_${ev}`} defaultValue={tpl(ev)?.providerTemplateId ?? ""} placeholder={`amser_${ev}`} /></Field>
                <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name={`on_${ev}`} defaultChecked={tpl(ev)?.enabled ?? true} /> ativo</label>
              </div>
            ))}
            <SubmitButton variant="secondary">Salvar templates</SubmitButton>
          </form>
        </Card>

        <Card title="Pix (sinal)" actions={<Badge tone={pix?.status === "connected" ? "green" : "amber"}>{pix?.status === "connected" ? "conectado" : "modo de teste"}</Badge>}>
          <p className="text-sm text-zinc-600">
            O sinal cai direto na conta do seu negócio no provedor de pagamento — o Amser não recebe nem repassa valores.
            A integração com o provedor definitivo será liberada em breve; até lá, as cobranças funcionam em modo de teste.
          </p>
        </Card>

        <Card title="Últimas mensagens" className="lg:col-span-2">
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr><th className="px-4 py-2 sm:px-2">Quando</th><th className="px-2">Evento</th><th className="px-2">Para</th><th className="px-2">Status</th><th className="px-2">Tent.</th><th className="px-2">Detalhe</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {outbox.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-1.5 sm:px-2">{(m.sentAt ?? m.scheduledAt).toLocaleString("pt-BR")}</td>
                    <td className="px-2">{EVENTS.find(([e]) => e === m.eventType)?.[1] ?? m.eventType}</td>
                    <td className="px-2">{maskPhone(m.toPhoneE164)}</td>
                    <td className="px-2"><Badge tone={OUT_TONE[m.status]}>{m.status}</Badge></td>
                    <td className="px-2 tabular-nums">{m.attempts}</td>
                    <td className="max-w-xs truncate px-2 text-xs text-zinc-500">{m.lastError ?? ""}</td>
                  </tr>
                ))}
                {!outbox.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-zinc-500">Nenhuma mensagem ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
