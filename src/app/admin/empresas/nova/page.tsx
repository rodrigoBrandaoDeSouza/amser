import { prisma } from "@/lib/db";
import { Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { SegmentSelect } from "@/components/SegmentSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { formatBRL } from "@/lib/format";
import { createTenantAction } from "../../actions";

export default async function NewTenant({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erro } = await flashParams(searchParams);
  const plans = await prisma.plan.findMany({ orderBy: { priceCents: "asc" } });
  return (
    <>
      <PageHeader title="Nova empresa" subtitle="Cadastro direto, sem prévia. O dono recebe acesso ao painel." />
      <Flash ok={ok} erro={erro} />
      <Card className="max-w-2xl">
        <form action={createTenantAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do negócio"><Input name="name" required minLength={2} maxLength={80} /></Field>
            <Field label="Segmento"><SegmentSelect /></Field>
            <Field label="Endereço da página (slug)" hint="Opcional. Ex.: studio-ana → /studio-ana">
              <Input name="slug" pattern="[a-z0-9-]{3,60}" placeholder="gerado a partir do nome" />
            </Field>
            <Field label="Plano">
              <Select name="planId" defaultValue={plans[0]?.id}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {formatBRL(p.priceCents)}/mês · {p.messageQuota} msgs</option>
                ))}
              </Select>
            </Field>
            <Field label="Telefone"><Input name="phone" inputMode="tel" /></Field>
            <Field label="Instagram"><Input name="instagram" placeholder="@" /></Field>
          </div>
          <hr className="border-zinc-200" />
          <h3 className="text-sm font-semibold">Acesso do dono</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome"><Input name="ownerName" required /></Field>
            <Field label="E-mail"><Input name="ownerEmail" type="email" required /></Field>
            <Field label="Senha inicial" hint="Mín. 10 caracteres"><Input name="ownerPassword" type="password" minLength={10} required /></Field>
          </div>
          <SubmitButton>Criar empresa</SubmitButton>
        </form>
      </Card>
    </>
  );
}
