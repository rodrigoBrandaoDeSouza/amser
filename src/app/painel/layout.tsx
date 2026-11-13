import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser, destroySession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { endSupportAction } from "./actions-completo";

export const metadata = { robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

const OWNER_NAV = [
  ["/painel", "Início"],
  ["/painel/agenda", "Agenda"],
  ["/painel/servicos", "Serviços"],
  ["/painel/equipe", "Equipe"],
  ["/painel/clientes", "Clientes"],
  ["/painel/relatorios", "Relatórios"],
  ["/painel/lista-de-espera", "Lista de espera"],
  ["/painel/cupons", "Cupons"],
  ["/painel/marca", "Marca"],
  ["/painel/unidades", "Unidades"],
  ["/painel/mensagens", "Mensagens"],
  ["/painel/integracoes", "Integrações"],
  ["/painel/configuracoes", "Configurações"],
  ["/painel/plano", "Plano"],
] as const;

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant, support } = await requireTenantUser({ allowStaff: true, allowBillingSuspended: true });
  const nav: (readonly [string, string])[] =
    user.role === "owner"
      ? [...OWNER_NAV]
      : [
          ["/painel/agenda", can(user, "viewAllAgendas") ? "Agenda" : "Minha agenda"],
          ...(can(user, "viewCustomers") ? ([["/painel/clientes", "Clientes"]] as const) : []),
          ...(can(user, "viewReports") ? ([["/painel/relatorios", "Relatórios"]] as const) : []),
        ];
  const sub = user.role === "owner" ? await prisma.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { periodEnd: "desc" } }) : null;
  return (
    <div className="min-h-dvh">
      {support && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-violet-700 px-4 py-2 text-sm text-white">
          <span>Modo suporte Amser em <strong>{tenant.name}</strong> — tudo que você fizer fica registrado na auditoria.</span>
          <form action={endSupportAction}><button className="rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30">Sair do modo suporte</button></form>
        </div>
      )}
      {tenant.status === "suspended" && (
        <div className="bg-red-700 px-4 py-2 text-center text-sm text-white">
          Sua página está suspensa por falta de pagamento. <Link href="/painel/plano" className="font-semibold underline">Regularizar agora</Link>
        </div>
      )}
      {sub?.status === "past_due" && tenant.status !== "suspended" && (
        <div className="bg-amber-500 px-4 py-2 text-center text-sm text-black">
          Fatura em aberto. Pague até {sub.graceUntil?.toLocaleDateString("pt-BR")} para evitar a suspensão.{" "}
          <Link href="/painel/plano" className="font-semibold underline">Ver fatura</Link>
        </div>
      )}
      {tenant.deletionScheduledAt && (
        <div className="bg-zinc-900 px-4 py-2 text-center text-sm text-white">
          Esta conta será excluída em {tenant.deletionScheduledAt.toLocaleDateString("pt-BR")}. Fale com o suporte para cancelar.
        </div>
      )}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/painel" className="truncate font-bold tracking-tight">{tenant.name}</Link>
          {tenant.status === "active" ? (
            <a href={`/${tenant.slug}`} target="_blank" className="hidden text-xs text-blue-700 underline sm:inline">ver página</a>
          ) : (
            <span className="hidden rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 sm:inline">página não publicada</span>
          )}
          <div className="ml-auto flex items-center gap-4 text-sm text-zinc-600">
            {!support && <Link href="/conta" className="hover:underline">Minha conta</Link>}
            <form action={logout}>
              <button className="hover:underline">Sair</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2 text-sm lg:flex-wrap lg:overflow-visible">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="shrink-0 rounded-md px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-100">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
