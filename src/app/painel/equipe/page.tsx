import { requireTenantUser } from "@/lib/auth/session";
import { Badge, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { saveProfessionalAction, createStaffLoginAction } from "../actions";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  const { db } = await requireTenantUser();
  const { ok, erro } = await flashParams(searchParams);
  const pros = await db.professional.findMany({
    include: { workingHours: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }, user: { select: { email: true } } },
    orderBy: { displayName: "asc" },
  });
  return (
    <>
      <PageHeader title="Equipe" subtitle="Profissionais, jornadas e acessos" />
      <Flash ok={ok} erro={erro} />
      <div className="space-y-4">
        {pros.map((p) => (
          <Card key={p.id} title={<span className="flex items-center gap-2">{p.displayName} {!p.active && <Badge>inativo</Badge>}</span>}>
            <form action={saveProfessionalAction} className="space-y-4">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="hoursSubmitted" value="1" />
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Nome exibido"><Input name="displayName" defaultValue={p.displayName} required /></Field>
                <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} /> Ativo</label>
              </div>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr><th className="pr-3 text-left">Dia</th><th className="px-1">Início</th><th className="px-1">Fim</th><th className="px-1">Início 2</th><th className="px-1">Fim 2</th></tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d, wd) => {
                      const hs = p.workingHours.filter((h) => h.weekday === wd);
                      return (
                        <tr key={wd}>
                          <td className="pr-3 font-medium">{d}</td>
                          {[0, 0, 1, 1].map((i, col) => {
                            const kind = col % 2 === 0 ? "s" : "e";
                            const val = kind === "s" ? hs[i]?.startTime : hs[i]?.endTime;
                            return (
                              <td key={col} className="px-1 py-0.5">
                                <Input type="time" name={`d${wd}${kind}${i + 1}`} defaultValue={val ?? ""} aria-label={`${d} ${kind === "s" ? "início" : "fim"} ${i + 1}`} className="w-28" />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-zinc-500">Deixe em branco os dias de folga. Use a segunda janela para pausas (ex.: 09:00–12:00 e 13:00–18:00).</p>
              <SubmitButton>Salvar</SubmitButton>
            </form>
            <div className="mt-4 border-t border-zinc-100 pt-4 text-sm">
              {p.user ? (
                <p className="text-zinc-600">Acesso ao painel: {p.user.email} (vê apenas a própria agenda)</p>
              ) : (
                <details>
                  <summary className="cursor-pointer text-zinc-700">Dar acesso ao painel para este profissional</summary>
                  <form action={createStaffLoginAction.bind(null, p.id)} className="mt-3 flex flex-wrap items-end gap-2">
                    <Field label="E-mail"><Input name="email" type="email" required /></Field>
                    <Field label="Senha inicial"><Input name="password" type="password" minLength={10} required /></Field>
                    <SubmitButton variant="secondary">Criar acesso</SubmitButton>
                  </form>
                </details>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Card title="Adicionar profissional" className="mt-6">
        <form action={saveProfessionalAction} className="flex flex-wrap items-end gap-3">
          <Field label="Nome exibido"><Input name="displayName" required /></Field>
          <SubmitButton>Adicionar</SubmitButton>
        </form>
        <p className="mt-2 text-xs text-zinc-500">Começa com jornada seg–sáb, 09:00–18:00. Ajuste depois.</p>
      </Card>
    </>
  );
}
