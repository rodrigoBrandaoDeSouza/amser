import { requireTenantUser } from "@/lib/auth/session";
import { depositsEnabled } from "@/lib/env";
import { Badge, Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { formatBRL } from "@/lib/format";
import { computeDepositCents } from "@/lib/scheduling/deposit";
import type { Service, ServiceCategory, ServiceProfessional } from "@prisma/client";
import { saveServiceAction } from "../actions";
import { ProfessionalPicker } from "./ProfessionalPicker";

type Svc = Service & { category: ServiceCategory | null; professionals: ServiceProfessional[] };

function ServiceForm({ svc, pros }: { svc?: Svc; pros: { id: string; displayName: string }[] }) {
  const cents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  return (
    <form action={saveServiceAction} className="grid gap-3 sm:grid-cols-2">
      {svc && <input type="hidden" name="id" value={svc.id} />}
      <Field label="Nome"><Input name="name" defaultValue={svc?.name} required maxLength={80} /></Field>
      <Field label="Categoria (opcional)"><Input name="category" defaultValue={svc?.category?.name} maxLength={40} /></Field>
      <div className="sm:col-span-2">
        <Field label="Descrição (opcional)"><Textarea name="description" rows={2} defaultValue={svc?.description?.replace(/^\[exemplo\]\s*/, "") ?? ""} maxLength={300} /></Field>
      </div>
      <Field label="Preço (R$)"><Input name="price" defaultValue={svc ? cents(svc.priceCents) : ""} inputMode="decimal" required placeholder="80,00" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Duração (min)"><Input name="duration" type="number" min={5} max={600} defaultValue={svc?.durationMinutes ?? 60} required /></Field>
        <Field label="Preparo (min)" hint="Intervalo após o atendimento"><Input name="buffer" type="number" min={0} max={120} defaultValue={svc?.bufferMinutes ?? 0} /></Field>
      </div>
      <Field label="Sinal via Pix" hint="Reduz faltas: o horário só é confirmado após o pagamento">
        <Select name="depositType" defaultValue={svc?.depositType ?? "percent"}>
          <option value="none">Sem sinal</option>
          <option value="percent">Percentual do preço</option>
          <option value="fixed">Valor fixo</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="% do sinal"><Input name="depositPercent" type="number" min={0} max={100} defaultValue={svc?.depositType === "percent" ? svc.depositValue : 30} /></Field>
        <Field label="Valor fixo (R$)"><Input name="depositFixed" inputMode="decimal" defaultValue={svc?.depositType === "fixed" ? cents(svc.depositValue) : ""} /></Field>
      </div>
      <div className="sm:col-span-2">
        <ProfessionalPicker pros={pros} defaultSelected={svc ? svc.professionals.map((sp) => sp.professionalId) : pros.map((p) => p.id)} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={svc ? svc.active : true} /> Ativo na página</label>
      <div className="sm:col-span-2"><SubmitButton>{svc ? "Salvar" : "Adicionar serviço"}</SubmitButton></div>
    </form>
  );
}

export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const { db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const [services, pros] = await Promise.all([
    db.service.findMany({ include: { category: true, professionals: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.professional.findMany({ where: { active: true }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Serviços" subtitle="Preço, duração e sinal de cada serviço" />
      {!depositsEnabled() && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O sinal via Pix ainda não está disponível: as reservas são confirmadas sem pagamento. A regra de sinal de cada serviço fica salva e passa a valer quando o Pix for ativado.
        </div>
      )}
      <Flash ok={ok} erro={erro} />
      <div className="space-y-3">
        {services.map((s) => {
          const dep = computeDepositCents(s.priceCents, s.depositType, s.depositValue);
          return (
            <details key={s.id} className="rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{s.name}</span>
                {s.description?.startsWith("[exemplo]") && <Badge tone="amber">exemplo</Badge>}
                {!s.active && <Badge>inativo</Badge>}
                <span className="text-zinc-500">{s.durationMinutes} min · {formatBRL(s.priceCents)}</span>
                {dep > 0 && <Badge tone="blue">sinal {formatBRL(dep)}</Badge>}
                {!s.professionals.length && <Badge tone="red">sem profissional</Badge>}
              </summary>
              <div className="border-t border-zinc-100 p-4"><ServiceForm svc={s} pros={pros} /></div>
            </details>
          );
        })}
      </div>
      <Card title="Novo serviço" className="mt-6"><ServiceForm pros={pros} /></Card>
    </>
  );
}
