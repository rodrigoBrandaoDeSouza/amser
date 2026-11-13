import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser, destroySession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

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
  ["/painel/lista-de-espera", "Lista de espera"],
  ["/painel/cupons", "Cupons"],
  ["/painel/marca", "Marca"],
  ["/painel/unidades", "Unidades"],
  ["/painel/integracoes", "Integrações"],
  ["/painel/configuracoes", "Configurações"],
  ["/painel/plano", "Plano"],
] as const;

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant } = await requireTenantUser({ allowStaff: true, allowBillingSuspended: true });
  const nav = user.role === "owner" ? OWNER_NAV : ([["/painel/agenda", "Minha agenda"]] as const);
  const sub = user.role === "owner" ? await prisma.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { periodEnd: "desc" } }) : null;
  return (
    <div className="min-h-dvh">
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
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/painel" className="truncate font-bold tracking-tight">{tenant.name}</Link>
          {tenant.status === "active" ? (
            <a href={`/${tenant.slug}`} target="_blank" className="hidden text-xs text-blue-700 underline sm:inline">ver página</a>
          ) : (
            <span className="hidden rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 sm:inline">página não publicada</span>
          )}
          <form action={logout} className="ml-auto text-sm text-zinc-600">
            <button className="hover:underline">Sair</button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2 text-sm">
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
