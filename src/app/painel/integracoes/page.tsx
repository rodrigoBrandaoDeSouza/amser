import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { messageUsage } from "@/lib/metrics";
import { maskPhone } from "@/lib/format";
import { env, embeddedSignupEnabled } from "@/lib/env";
import { ConnectWhatsappButton } from "./ConnectWhatsappButton";
import { DEFAULT_TEMPLATES, OPT_OUT_FOOTER } from "@/lib/whatsapp/templates";
import { provisionTemplatesAction, saveTemplatesAction, saveWhatsappAction, syncTemplatesAction, testWhatsappAction } from "../actions";

const EVENTS = [
  ["booking_confirmed", "Confirmação de agendamento"],
  ["payment_pending", "Pix pendente"],
  ["reminder", "Lembrete"],
  ["presence_request", "Confirmação de presença"],
  ["rescheduled", "Remarcação"],
  ["cancelled", "Cancelamento"],
  ["waitlist_offer", "Lista de espera"],
] as const;

const OUT_TONE = { pending: "amber", sent: "blue", delivered: "green", read: "green", failed: "red", dead: "red", skipped: "zinc" } as const;
const TPL_TONE = (s: string) => (s === "APPROVED" ? "green" : s === "PENDING" || s === "IN_APPEAL" ? "amber" : s === "UNKNOWN" ? "zinc" : "red");

export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const [conn, templates, outbox, usage] = await Promise.all([
    db.whatsappConnection.findFirst({}),
    db.messageTemplate.findMany({}),
    db.messageOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    messageUsage(tenant.id),
  ]);
  const tpl = (ev: string) => templates.find((t) => t.eventType === ev);
  const mock = env().WHATSAPP_PROVIDER === "mock";
  const connected = conn?.status === "connected";
  const webhookUrl = `${env().APP_URL.replace(/\/$/, "")}/api/integrations/whatsapp/webhook`;
  const es = embeddedSignupEnabled();
  const connectButton = (label?: string) => (
    <ConnectWhatsappButton appId={env().WHATSAPP_APP_ID} configId={env().WHATSAPP_ES_CONFIG_ID} graphVersion={env().WHATSAPP_GRAPH_VERSION} simulate={mock} label={label} />
  );

  return (
    <>
      <PageHeader title="Integrações" subtitle="WhatsApp Business Platform (API oficial da Meta) e Pix" />
      <Flash ok={ok} erro={erro} />
      {mock && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Modo de teste: mensagens não saem de verdade (aparecem no log do servidor). Em produção use <code>WHATSAPP_PROVIDER=meta</code>.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="1. Conectar o número"
          actions={<Badge tone={connected ? "green" : conn?.status === "error" || conn?.status === "disabled" ? "red" : "amber"}>{connected ? "conectado" : conn?.status === "error" ? "erro" : conn?.status === "disabled" ? "desconectado" : "não conectado"}</Badge>}
        >
          {connected && conn && (
            <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-sm">
              <div className="font-medium">{conn.verifiedName ?? "—"} · {conn.displayPhone ?? ""}</div>
              <div className="text-zinc-600">
                Qualidade: <Badge tone={conn.qualityRating === "GREEN" ? "green" : conn.qualityRating === "YELLOW" ? "amber" : conn.qualityRating === "RED" ? "red" : "zinc"}>{conn.qualityRating ?? "—"}</Badge>
                {" "}· validado em {conn.lastCheckedAt?.toLocaleString("pt-BR")}
              </div>
              {conn.onboarding === "coexistence" && (
                <p className="mt-2 text-zinc-600">
                  Este número <strong>continua no app WhatsApp Business</strong> do seu celular: as conversas seguem normais por lá, e o Amser envia só as
                  mensagens automáticas (confirmações, lembretes). Listas de transmissão e mensagens temporárias deixam de funcionar neste número.
                </p>
              )}
            </div>
          )}
          {conn?.lastError && <p className="mb-3 text-sm text-red-700">{conn.lastError}</p>}
          {es && !connected && (
            <div className="mb-4 space-y-3">
              <p className="text-sm text-zinc-600">
                Clique, entre com o Facebook do negócio e escolha o número. <strong>Já usa o app WhatsApp Business?</strong> Escolha o mesmo número: ele
                continua funcionando no celular, e o Amser passa a enviar as confirmações e lembretes por ele.
              </p>
              {connectButton()}
            </div>
          )}
          {es ? (
            <details className="text-sm" open={!!conn && !connected && conn.onboarding === "manual" && !!conn.phoneNumberId}>
              <summary className="cursor-pointer text-zinc-700">{connected ? "Trocar ou reconectar o número" : "Conexão manual (avançado)"}</summary>
              <div className="mt-3 space-y-4">
                {connected && connectButton("Reconectar com a Meta")}
                <p className="text-xs text-zinc-500">Ou informe os IDs e o token de um usuário do sistema:</p>
              <form action={saveWhatsappAction} className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone Number ID" hint="Meta → WhatsApp → Configuração da API"><Input name="phoneNumberId" defaultValue={conn?.phoneNumberId ?? ""} inputMode="numeric" required /></Field>
                <Field label="WhatsApp Business Account ID (WABA)"><Input name="wabaId" defaultValue={conn?.wabaId ?? ""} inputMode="numeric" required /></Field>
                <div className="sm:col-span-2">
                  <Field
                    label="Token de acesso permanente (usuário do sistema)"
                    hint={conn?.encryptedCredentials ? "Já configurado. Preencha só para substituir. Fica criptografado e nunca é exibido." : "Gerado no Gerenciador de Negócios com as permissões whatsapp_business_messaging e whatsapp_business_management."}
                  >
                    <Input name="accessToken" type="password" autoComplete="off" required={!conn?.encryptedCredentials} />
                  </Field>
                </div>
                <div className="sm:col-span-2"><SubmitButton pendingText="Validando na Meta…">Salvar e validar</SubmitButton></div>
                <p className="text-xs text-zinc-500 sm:col-span-2">
                  Quais mensagens enviar e em que horário: <a href="/painel/mensagens" className="underline">Mensagens automáticas</a>.
                </p>
              </form>
              </div>
            </details>
          ) : (
          <form action={saveWhatsappAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone Number ID" hint="Meta → WhatsApp → Configuração da API"><Input name="phoneNumberId" defaultValue={conn?.phoneNumberId ?? ""} inputMode="numeric" required /></Field>
            <Field label="WhatsApp Business Account ID (WABA)"><Input name="wabaId" defaultValue={conn?.wabaId ?? ""} inputMode="numeric" required /></Field>
            <div className="sm:col-span-2">
              <Field
                label="Token de acesso permanente (usuário do sistema)"
                hint={conn?.encryptedCredentials ? "Já configurado. Preencha só para substituir. Fica criptografado e nunca é exibido." : "Gerado no Gerenciador de Negócios com as permissões whatsapp_business_messaging e whatsapp_business_management."}
              >
                <Input name="accessToken" type="password" autoComplete="off" required={!conn?.encryptedCredentials} />
              </Field>
            </div>
            <div className="sm:col-span-2"><SubmitButton pendingText="Validando na Meta…">Salvar e validar</SubmitButton></div>
            <p className="text-xs text-zinc-500 sm:col-span-2">
              Quais mensagens enviar e em que horário: <a href="/painel/mensagens" className="underline">Mensagens automáticas</a>.
            </p>
          </form>
          )}
          {connected && (
            <form action={testWhatsappAction} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-50 p-3">
              <Field label="Enviar mensagem de teste para" hint="Usa o modelo “hello_world” da Meta (em inglês), já aprovado em toda conta nova.">
                <Input name="testPhone" inputMode="tel" placeholder="(11) 98888-7777" required />
              </Field>
              <SubmitButton variant="secondary" pendingText="Enviando…">Enviar teste</SubmitButton>
            </form>
          )}
          <details className="mt-4 text-xs text-zinc-600">
            <summary className="cursor-pointer">Configuração do webhook (uma vez, no app da Meta)</summary>
            <p className="mt-2">URL de callback: <code className="break-all">{webhookUrl}</code></p>
            <p>Campos: <code>messages</code>, <code>message_template_status_update</code> e, para coexistência, <code>account_update</code>, <code>smb_message_echoes</code>, <code>history</code> e <code>smb_app_state_sync</code>. O token de verificação fica com a equipe Amser.</p>
          </details>
        </Card>

        <Card
          title="2. Templates de mensagem"
          actions={
            <div className="flex gap-2">
              <form action={provisionTemplatesAction}><Button type="submit" disabled={!connected && !mock}>Criar na Meta</Button></form>
              <form action={syncTemplatesAction}><Button variant="secondary" type="submit" disabled={!connected && !mock}>Atualizar status</Button></form>
            </div>
          }
        >
          <p className="mb-3 text-sm text-zinc-600">
            Mensagens automáticas só podem usar templates aprovados pela Meta (categoria Utilidade). Criamos os modelos padrão com o rodapé “{OPT_OUT_FOOTER}”.
            Incluído no seu plano: {usage.quota} mensagens/mês (usadas: {usage.sent}).
          </p>
          <ul className="divide-y divide-zinc-100 text-sm">
            {EVENTS.map(([ev, label]) => {
              const t = tpl(ev);
              const def = DEFAULT_TEMPLATES.find((d) => d.event === ev);
              return (
                <li key={ev} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{label}</span>
                  <code className="text-xs text-zinc-500">{t?.providerTemplateId ?? def?.name}</code>
                  <span className="ml-auto flex items-center gap-1">
                    {t ? <Badge tone={TPL_TONE(t.status)}>{t.status === "UNKNOWN" ? "não sincronizado" : t.status}</Badge> : <Badge>não criado</Badge>}
                    {t?.rejectedReason && t.rejectedReason !== "NONE" && <span className="text-xs text-red-700">{t.rejectedReason}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-zinc-700">Usar templates próprios (avançado)</summary>
            <form action={saveTemplatesAction} className="mt-3 space-y-2">
              {EVENTS.map(([ev, label]) => (
                <Field key={ev} label={label}>
                  <Input name={`tpl_${ev}`} defaultValue={tpl(ev)?.providerTemplateId ?? ""} placeholder={DEFAULT_TEMPLATES.find((d) => d.event === ev)?.name} />
                </Field>
              ))}
              <p className="text-xs text-zinc-500">Em branco = modelo padrão do Amser. Variáveis do corpo: {"{{1}}"} cliente, {"{{2}}"} serviço, {"{{3}}"} data/hora, {"{{4}}"} negócio. Botão URL (índice 0) com sufixo {"{{1}}"}.</p>
              <SubmitButton variant="secondary">Salvar nomes</SubmitButton>
            </form>
          </details>
        </Card>

        <Card title="Pix (sinal)" actions={<Badge tone="amber">modo de teste</Badge>}>
          <p className="text-sm text-zinc-600">
            O sinal é cobrado só por Pix e cai direto na conta do seu negócio no provedor de pagamento — o Amser não recebe nem repassa valores.
            A integração com o provedor definitivo será liberada em breve; até lá, as cobranças funcionam em modo de teste.
          </p>
        </Card>

        <Card title="Como o cliente interage" className="text-sm">
          <ul className="list-disc space-y-1 pl-5 text-zinc-600">
            <li>Na confirmação de presença, o cliente toca em <strong>Confirmo presença</strong> e o agendamento é confirmado na hora.</li>
            <li>Em <strong>Preciso remarcar</strong>, recebe o link para escolher outro horário.</li>
            <li>Se responder <strong>SAIR</strong>, paramos todas as mensagens automáticas para ele (LGPD).</li>
            <li>Outras mensagens chegam no seu WhatsApp normalmente para você responder.</li>
          </ul>
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
                    <td className="max-w-xs truncate px-2 text-xs text-zinc-500" title={m.lastError ?? ""}>{m.lastError ?? ""}</td>
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
