import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Button, Card, Input, LinkButton, PageHeader } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { maskPhone } from "@/lib/format";
import { normalizePhoneBR } from "@/lib/format";

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { db } = await requireTenantUser();
  const { get } = await flashParams(searchParams);
  const q = (get("q") ?? "").trim().slice(0, 60);
  const phone = q ? normalizePhoneBR(q) : null;
  const customers = await db.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(phone ? [{ phoneE164: phone }] : []), { phoneE164: { contains: q.replace(/\D/g, "") || "__" } }] }
      : {},
    include: { appointments: { select: { status: true, startsAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Sua base é sua: exporte quando quiser."
        actions={<LinkButton href="/api/painel/clientes/export" prefetch={false}>Exportar CSV</LinkButton>}
      />
      <form className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome ou telefone" />
        <Button variant="secondary" type="submit">Buscar</Button>
      </form>
      <Card>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr><th className="px-4 py-2 sm:px-2">Nome</th><th className="px-2">Telefone</th><th className="px-2 text-right">Visitas</th><th className="px-2 text-right">Faltas</th><th className="px-2 text-right">Cancel.</th><th className="px-2">Última</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {customers.map((c) => {
                const visits = c.appointments.filter((a) => a.status === "concluido").length;
                const noShows = c.appointments.filter((a) => a.status === "nao_compareceu").length;
                const cancels = c.appointments.filter((a) => a.status === "cancelado").length;
                const last = c.appointments.map((a) => a.startsAt).sort((a, b) => b.getTime() - a.getTime())[0];
                const consent = (c.consentJson as Record<string, unknown>)?.whatsapp === true;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 sm:px-2"><span className="font-medium">{c.name}</span> {!consent && <Badge>sem opt-in</Badge>}</td>
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
    </>
  );
}
