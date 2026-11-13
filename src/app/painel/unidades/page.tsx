import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { planLimits } from "@/lib/plans";
import { saveUnitAction } from "../actions-fase2";

const TZ = [
  ["America/Sao_Paulo", "Brasília (SP, RJ, MG, Sul, GO, DF…)"],
  ["America/Bahia", "Bahia"],
  ["America/Fortaleza", "Fortaleza (CE, RN, PB, PI, MA)"],
  ["America/Recife", "Recife (PE, AL, SE)"],
  ["America/Belem", "Belém (PA, AP, TO)"],
  ["America/Manaus", "Manaus (AM)"],
  ["America/Cuiaba", "Cuiabá (MT)"],
  ["America/Campo_Grande", "Campo Grande (MS)"],
  ["America/Porto_Velho", "Porto Velho (RO)"],
  ["America/Boa_Vista", "Boa Vista (RR)"],
  ["America/Rio_Branco", "Rio Branco (AC)"],
  ["America/Noronha", "Fernando de Noronha"],
];

export default async function UnitsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const [units, limits] = await Promise.all([
    db.unit.findMany({ include: { _count: { select: { professionals: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    planLimits(tenant),
  ]);
  const activeCount = units.filter((u) => u.active).length;

  const form = (u?: (typeof units)[number]) => (
    <form action={saveUnitAction} className="grid gap-3 sm:grid-cols-2">
      {u && <input type="hidden" name="id" value={u.id} />}
      <Field label="Nome"><Input name="name" defaultValue={u?.name} required maxLength={60} /></Field>
      <Field label="Telefone"><Input name="phone" defaultValue={u?.phone ?? ""} /></Field>
      <div className="sm:col-span-2"><Field label="Endereço"><Input name="address" defaultValue={u?.address ?? ""} maxLength={200} /></Field></div>
      <Field label="Fuso horário">
        <Select name="timezone" defaultValue={u?.timezone ?? tenant.timezone}>
          {TZ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Ordem na página"><Input name="sortOrder" type="number" defaultValue={u?.sortOrder ?? units.length} /></Field>
      {u && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Ativa</label>}
      <div className="sm:col-span-2"><SubmitButton>{u ? "Salvar" : "Adicionar unidade"}</SubmitButton></div>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Unidades"
        subtitle={`Seu plano permite ${Number.isFinite(limits.units) ? limits.units : "ilimitadas"} unidade(s) ativa(s) — em uso: ${activeCount}. Com 2 ou mais, o cliente escolhe a unidade na página.`}
      />
      <Flash ok={ok} erro={erro} />
      <div className="space-y-4">
        {units.map((u) => (
          <Card key={u.id} title={<span className="flex items-center gap-2">{u.name} {!u.active && <Badge>inativa</Badge>} <span className="text-xs font-normal text-zinc-500">{u._count.professionals} profissional(is)</span></span>}>
            {form(u)}
          </Card>
        ))}
      </div>
      {activeCount < limits.units && <Card title="Nova unidade" className="mt-6">{form()}</Card>}
    </>
  );
}
