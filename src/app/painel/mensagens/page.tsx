import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { getMessageSettings, previewMessage } from "@/lib/messages";
import { saveMessagesAction } from "../actions-mensagens";

const STATUS_TONE = (s: string | null) => (s === "APPROVED" ? "green" : s === "PENDING" || s === "IN_APPEAL" ? "amber" : !s || s === "UNKNOWN" ? "zinc" : "red");
const STATUS_TEXT = (s: string | null) =>
  s === "APPROVED" ? "aprovado na Meta" : s === "PENDING" ? "em análise na Meta" : !s || s === "UNKNOWN" ? "ainda não criado na Meta" : s.toLowerCase();

export default async function MessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const s = await getMessageSettings(tenant.id);
  const service = (await db.service.findFirst({ where: { active: true }, orderBy: { name: "asc" } }))?.name ?? "Corte";
  const sample = { customer: "Maria", service, when: "sex., 15/11, 14:00", business: s.tenantName };

  return (
    <>
      <PageHeader
        title="Mensagens automáticas"
        subtitle="Escolha o que seus clientes recebem no WhatsApp e quando. Só recebe quem autorizou na hora de agendar."
      />
      <Flash ok={ok} erro={erro} />
      {!s.connected && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O WhatsApp da empresa ainda não está conectado. As configurações abaixo já ficam salvas.{" "}
          <Link href="/painel/integracoes" className="font-medium underline">Conectar número</Link>
        </div>
      )}

      <form action={saveMessagesAction} className="space-y-6">
        <Card title="Quais mensagens enviar">
          <ul className="divide-y divide-zinc-100">
            {s.events.map((e) => {
              const p = previewMessage(e.event, sample);
              return (
                <li key={e.event} className="grid gap-3 py-4 md:grid-cols-[1fr_320px]">
                  <div>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" name={`on_${e.event}`} defaultChecked={e.enabled} className="mt-1 h-5 w-5" />
                      <span>
                        <span className="block font-medium">{e.label}</span>
                        <span className="block text-sm text-zinc-600">{e.when}</span>
                        <span className="mt-1 inline-flex"><Badge tone={STATUS_TONE(e.status)}>{STATUS_TEXT(e.status)}</Badge></span>
                      </span>
                    </label>
                  </div>
                  <div className="rounded-xl bg-[#e7ddd3] p-3" aria-label={`Prévia: ${e.label}`}>
                    <div className="rounded-lg rounded-tl-none bg-white p-2.5 text-[13px] leading-snug text-zinc-900 shadow-sm">
                      <p>{p.body}</p>
                      <p className="mt-1.5 text-[11px] text-zinc-500">{p.footer}</p>
                    </div>
                    {p.buttons.map((b) => (
                      <div key={b} className="mt-1 rounded-lg bg-white py-1.5 text-center text-[13px] font-medium text-sky-600 shadow-sm">{b}</div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Quando enviar">
            <div className="space-y-3">
              <Field label="Lembretes (horas antes do horário)" hint="Até 3 lembretes, separados por vírgula. Ex.: 24, 2">
                <Input name="reminderHours" defaultValue={s.reminderHours.join(", ")} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Pedir confirmação de presença (h antes)"><Input type="number" name="presenceRequestHours" min={1} max={168} defaultValue={s.presenceRequestHours} /></Field>
                <Field label="Prazo para confirmar (h antes)"><Input type="number" name="presenceDeadlineHours" min={0} max={167} defaultValue={s.presenceDeadlineHours} /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="autoReleaseUnconfirmed" defaultChecked={s.autoReleaseUnconfirmed} className="mt-0.5" />
                <span>Liberar o horário de quem não confirmar até o prazo (só agendamentos sem sinal). A lista de espera é avisada.</span>
              </label>
            </div>
          </Card>
          <Card title="Horário e lista de espera">
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">Lembretes e pedidos de confirmação só saem dentro desta janela. Confirmações e cancelamentos saem na hora.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Enviar a partir de"><Input type="time" name="sendWindowStart" defaultValue={s.sendWindowStart} /></Field>
                <Field label="Até"><Input type="time" name="sendWindowEnd" defaultValue={s.sendWindowEnd} /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="waitlistEnabled" defaultChecked={s.waitlistEnabled} className="mt-0.5" />
                <span>Mostrar “Avise-me se abrir um horário” na página e oferecer os horários liberados.</span>
              </label>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Salvar mensagens</SubmitButton>
          <span className="text-xs text-zinc-500">
            Os textos são modelos aprovados pela Meta (obrigatório no WhatsApp oficial). Para criá-los na sua conta, use{" "}
            <Link href="/painel/integracoes" className="underline">Integrações → Criar na Meta</Link>.
          </span>
        </div>
      </form>
    </>
  );
}
