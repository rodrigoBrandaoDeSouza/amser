import { Badge, Button, Card, Flash, PageHeader } from "@/components/ui";
import { flashParams, type SearchParams } from "@/lib/actions";
import { allFlags } from "@/lib/flags";
import { setFlagAction } from "../actions";

export default async function FlagsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erro } = await flashParams(searchParams);
  const flags = await allFlags("global");
  return (
    <>
      <PageHeader title="Feature flags" subtitle="Liga e desliga recursos para toda a plataforma. Cada empresa pode ter uma exceção (na página da empresa)." />
      <Flash ok={ok} erro={erro} />
      <Card>
        <ul className="divide-y divide-zinc-100 text-sm">
          {flags.map((f) => {
            const effective = f.enabled ?? f.default;
            return (
              <li key={f.key} className="flex flex-wrap items-center gap-3 py-3">
                <div>
                  <div className="font-medium">{f.label}</div>
                  <code className="text-xs text-zinc-500">{f.key}</code>
                </div>
                <Badge tone={effective ? "green" : "red"}>{effective ? "ligado" : "desligado"}</Badge>
                {f.enabled === null && <span className="text-xs text-zinc-500">(padrão)</span>}
                <span className="ml-auto flex gap-1">
                  <form action={setFlagAction.bind(null, f.key, "global", "on")}><Button variant="secondary" type="submit" disabled={f.enabled === true}>Ligar</Button></form>
                  <form action={setFlagAction.bind(null, f.key, "global", "off")}><Button variant="secondary" type="submit" disabled={f.enabled === false}>Desligar</Button></form>
                  <form action={setFlagAction.bind(null, f.key, "global", "default")}><Button variant="ghost" type="submit" disabled={f.enabled === null}>Padrão</Button></form>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
