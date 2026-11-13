import { requireTenantUser } from "@/lib/auth/session";
import { Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { cancellationPolicy } from "@/lib/public";
import { saveSettingsAction } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const t = tenant;
  return (
    <>
      <PageHeader title="Configurações" subtitle="Dados da página e regras da agenda" />
      <Flash ok={ok} erro={erro} />
      <form action={saveSettingsAction} className="grid gap-6 lg:grid-cols-2">
        <Card title="Dados exibidos na página">
          <div className="space-y-3">
            <Field label="Descrição curta"><Textarea name="description" defaultValue={t.description ?? ""} rows={2} maxLength={300} /></Field>
            <Field label="Endereço"><Input name="address" defaultValue={t.address ?? ""} maxLength={200} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telefone"><Input name="phone" defaultValue={t.phone ?? ""} /></Field>
              <Field label="WhatsApp para contato"><Input name="whatsappContact" defaultValue={t.whatsappContact ?? ""} /></Field>
            </div>
            <Field label="Instagram"><Input name="instagram" defaultValue={t.instagramHandle ? `@${t.instagramHandle}` : ""} /></Field>
          </div>
        </Card>

        <Card title="Agenda">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Antecedência mínima (min)"><Input type="number" name="minAdvanceMinutes" min={0} defaultValue={t.minAdvanceMinutes} /></Field>
            <Field label="Agendar até (dias à frente)"><Input type="number" name="maxHorizonDays" min={1} max={365} defaultValue={t.maxHorizonDays} /></Field>
            <Field label="Intervalo entre horários">
              <Select name="slotStepMinutes" defaultValue={String(t.slotStepMinutes)}>
                {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
              </Select>
            </Field>
            <Field label="Cancelar/remarcar grátis até (h antes)"><Input type="number" name="cancelLimitHours" min={0} max={168} defaultValue={t.cancelLimitHours} /></Field>
          </div>
        </Card>

        <Card title="Sinal e faltas">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reserva aguarda o Pix por (min)"><Input type="number" name="holdMinutes" min={5} max={120} defaultValue={t.holdMinutes} /></Field>
            <Field label="Lembretes (horas antes)" hint="Separe por vírgula, ex.: 24, 2"><Input name="reminderHours" defaultValue={t.reminderHours.join(", ")} /></Field>
            <Field label="Pedir confirmação de presença (h antes)"><Input type="number" name="presenceRequestHours" min={1} max={168} defaultValue={t.presenceRequestHours} /></Field>
            <Field label="Prazo para confirmar (h antes)"><Input type="number" name="presenceDeadlineHours" min={0} max={72} defaultValue={t.presenceDeadlineHours} /></Field>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="autoReleaseUnconfirmed" defaultChecked={t.autoReleaseUnconfirmed} className="mt-0.5" />
            <span>Liberar automaticamente o horário de quem não confirmar presença no prazo (vale para agendamentos sem sinal).</span>
          </label>
        </Card>

        <Card title="Política de cancelamento">
          <Field label="Texto exibido antes do agendamento e do pagamento" hint="Deixe em branco para usar o texto padrão abaixo">
            <Textarea name="cancellationPolicyText" defaultValue={t.cancellationPolicyText ?? ""} rows={4} maxLength={600} />
          </Field>
          <p className="mt-2 text-xs text-zinc-500">Atual: {cancellationPolicy(t)}</p>
        </Card>

        <div className="lg:col-span-2"><SubmitButton>Salvar configurações</SubmitButton></div>
      </form>
    </>
  );
}
