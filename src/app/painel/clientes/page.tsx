import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Flash, Input, LinkButton, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { maskPhone, normalizePhoneBR } from "@/lib/format";
import { importCustomersAction } from "../actions-completo";

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { db, user } = await requireTenantUser({ permission: "viewCustomers" });
  const { ok, erro, get } = await flashParams(searchParams);
  const q = (get("q") ?? "").trim().slice(0, 60);
  const tag = (get("etiqueta") ?? "").trim().toLowerCase().slice(0, 30);
  const phone = q ? normalizePhoneBR(q) : null;
  const digits = q.replace(/\D/g, "");
  const customers = await db.customer.findMany({
    where: {
      anonymizedAt: null,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(phone ? [{ phoneE164: phone }] : []), ...(digits.length >= 4 ? [{ phoneE164: { contains: digits } }] : [])] }
        : {}),
    },
    include: { appointments: { select: { status: true, startsAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const allTags = [...new Set((await db.customer.findMany({ where: { anonymizedAt: null }, select: { tags: true }, take: 2000 })).flatMap((c) => c.tags))].sort();
  const isOwner = user.role === "owner";

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Sua base é sua: importe, organize com etiquetas e exporte quando quiser."
        actions={isOwner ? <LinkButton href="/api/painel/clientes/export" prefetch={false}>Exportar CSV</LinkButton> : undefined}
      />
      <Flash ok={ok} erro={erro} />
      <form className="mb-4 flex max-w-xl flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome ou telefone" className="min-w-0 flex-1" />
        {tag && <input type="hidden" name="etiqueta" value={tag} />}
        <Button variant="secondary" type="submit">Buscar</Button>
      </form>
      {allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
          <Link href="/painel/clientes" className={`rounded-full border px-2 py-0.5 ${!tag ? "bg-zinc-900 text-white" : "bg-white"}`}>todas</Link>
          {allTags.map((t) => (
            <Link key={t} href={`/painel/clientes?etiqueta=${encodeURIComponent(t)}`} className={`rounded-full border px-2 py-0.5 ${tag === t ? "bg-zinc-900 text-white" : "bg-white"}`}>{t}</Link>
          ))}
        </div>
      )}
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr><th className="px-4 py-2 sm:px-2">Nome</th><th className="px-2">Telefone</th><th className="px-2 text-right">Visitas</th><th className="px-2 text-right">Faltas</th><th className="px-2 text-right">Cancel.</th><th className="px-2">Última</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {customers.map((c) => {
                const visits = c.appointments.filter((a) => a.status === "concluido").length;
                const noShows = c.appointments.filter((a) => a.status === "nao_compareceu").length;
                const cancels = c.appointments.filter((a) => a.status === "cancelado").length;
                const last = c.appointments.map((a) => a.startsAt).sort((a, b) => b.getTime() - a.getTime())[0];
                const consent = (c.consentJson as Record<string, unknown>)?.whatsapp === true && !c.optedOutAt;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 sm:px-2">
                      <Link href={`/painel/clientes/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{" "}
                      {!consent && <Badge>sem WhatsApp</Badge>}
                      {c.tags.slice(0, 3).map((t) => <span key={t} className="ml-1 text-xs text-zinc-500">#{t}</span>)}
                    </td>
                    <td className="px-2">{maskPhone(c.phoneE164)}</td>
                    <td className="px-2 text-right tabular-nums">{visits}</td>
                    <td className="px-2 text-right tabular-nums">{noShows > 0 ? <Badge tone="red">{noShows}</Badge> : 0}</td>
                    <td className="px-2 text-right tabular-nums">{cancels}</td>
                    <td className="px-2">{last?.toLocaleDateString("pt-BR") ?? "—"}</td>
                  </tr>
                );
              })}
              {!customers.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-zinc-500">Nenhum cliente encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {isOwner && (
        <Card title="Importar clientes (CSV)" className="mt-6">
          <form action={importCustomersAction} className="space-y-3">
            <p className="text-sm text-zinc-600">
              Colunas aceitas: <code>nome</code>, <code>telefone</code> (obrigatórias), <code>email</code>, <code>observacoes</code>, <code>etiquetas</code> (separadas por |) e <code>aceita_whatsapp</code> (sim/não).
              Clientes já cadastrados (mesmo telefone) não são duplicados.
            </p>
            <p className="text-xs text-amber-800">
              Só marque “aceita_whatsapp = sim” para quem autorizou receber mensagens do seu negócio (LGPD e regras do WhatsApp).
            </p>
            <Input type="file" name="file" accept=".csv,text/csv" required />
            <SubmitButton variant="secondary" pendingText="Importando…">Importar</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
