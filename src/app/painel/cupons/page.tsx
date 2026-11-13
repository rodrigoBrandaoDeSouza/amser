import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { formatBRL } from "@/lib/format";
import { saveCouponAction, toggleCouponAction } from "../actions-fase2";

export default async function CouponsPage({ searchParams }: { searchParams: SearchParams }) {
  const { db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const [coupons, services] = await Promise.all([
    db.coupon.findMany({ orderBy: { createdAt: "desc" } }),
    db.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Cupons" subtitle="Descontos para divulgar no Instagram ou para clientes fiéis. O sinal é calculado sobre o preço com desconto." />
      <Flash ok={ok} erro={erro} />
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr><th className="px-4 py-2 sm:px-2">Código</th><th className="px-2">Desconto</th><th className="px-2">Validade</th><th className="px-2">Usos</th><th className="px-2">Serviços</th><th className="px-2" /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {coupons.map((c) => {
                const expired = !!c.validUntil && c.validUntil < now;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono font-semibold sm:px-2">
                      {c.code} {!c.active ? <Badge>pausado</Badge> : expired ? <Badge tone="red">vencido</Badge> : <Badge tone="green">ativo</Badge>}
                    </td>
                    <td className="px-2">{c.discountType === "percent" ? `${c.discountValue}%` : formatBRL(c.discountValue)}</td>
                    <td className="px-2 text-xs">
                      {c.validFrom ? c.validFrom.toLocaleDateString("pt-BR") : "—"} a {c.validUntil ? c.validUntil.toLocaleDateString("pt-BR") : "sem fim"}
                    </td>
                    <td className="px-2 tabular-nums">{c.redemptionsCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</td>
                    <td className="px-2 text-xs">{c.serviceIds.length ? services.filter((s) => c.serviceIds.includes(s.id)).map((s) => s.name).join(", ") : "todos"}</td>
                    <td className="px-2 text-right">
                      <form action={toggleCouponAction.bind(null, c.id)}><Button variant="ghost" type="submit">{c.active ? "Pausar" : "Reativar"}</Button></form>
                    </td>
                  </tr>
                );
              })}
              {!coupons.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-zinc-500">Nenhum cupom ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Novo cupom" className="mt-6">
        <form action={saveCouponAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Código" hint="Ex.: VERAO10"><Input name="code" required maxLength={30} className="uppercase" /></Field>
          <Field label="Tipo">
            <Select name="discountType" defaultValue="percent"><option value="percent">Percentual</option><option value="fixed">Valor fixo</option></Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="%"><Input name="discountPercent" type="number" min={1} max={100} defaultValue={10} /></Field>
            <Field label="R$"><Input name="discountFixed" inputMode="decimal" placeholder="10,00" /></Field>
          </div>
          <Field label="Válido de"><Input name="validFrom" type="date" /></Field>
          <Field label="Até"><Input name="validUntil" type="date" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Limite total"><Input name="maxRedemptions" type="number" min={1} placeholder="sem limite" /></Field>
            <Field label="Por cliente"><Input name="maxPerCustomer" type="number" min={1} defaultValue={1} /></Field>
          </div>
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">Só para estes serviços (vazio = todos)</legend>
            <div className="flex flex-wrap gap-3">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="serviceIds" value={s.id} /> {s.name}</label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-3"><SubmitButton>Criar cupom</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}
