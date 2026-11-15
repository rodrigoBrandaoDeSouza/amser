import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser, destroySession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { endSupportAction } from "./actions-completo";
import { SideNav, FooterLink, type NavGroup } from "@/components/nav/SideNav";
import { Icon } from "@/components/nav/icons";

export const metadata = { robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

const OWNER_NAV: NavGroup[] = [
  {
    items: [
      { href: "/painel", label: "Início", icon: "home", exact: true },
      { href: "/painel/agenda", label: "Agenda", icon: "calendar" },
      { href: "/painel/clientes", label: "Clientes", icon: "users" },
      { href: "/painel/lista-de-espera", label: "Lista de espera", icon: "clock" },
    ],
  },
  {
    title: "Seu negócio",
    items: [
      { href: "/painel/servicos", label: "Serviços e preços", icon: "scissors" },
      { href: "/painel/equipe", label: "Equipe", icon: "team" },
      { href: "/painel/unidades", label: "Unidades", icon: "store" },
      { href: "/painel/cupons", label: "Cupons", icon: "ticket" },
      { href: "/painel/relatorios", label: "Relatórios", icon: "chart" },
    ],
  },
  {
    title: "Página e WhatsApp",
    items: [
      { href: "/painel/marca", label: "Marca e página", icon: "palette" },
      { href: "/painel/mensagens", label: "Mensagens automáticas", icon: "message" },
      { href: "/painel/integracoes", label: "Integrações", icon: "plug" },
    ],
  },
  {
    title: "Conta",
    items: [
      { href: "/painel/configuracoes", label: "Configurações", icon: "settings" },
      { href: "/painel/plano", label: "Plano e faturas", icon: "card" },
    ],
  },
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant, support } = await requireTenantUser({ allowStaff: true, allowBillingSuspended: true });
  const nav: NavGroup[] =
    user.role === "owner"
      ? OWNER_NAV
      : [
          {
            items: [
              { href: "/painel/agenda", label: can(user, "viewAllAgendas") ? "Agenda" : "Minha agenda", icon: "calendar" },
              ...(can(user, "viewCustomers") ? [{ href: "/painel/clientes", label: "Clientes", icon: "users" as const }] : []),
              ...(can(user, "viewReports") ? [{ href: "/painel/relatorios", label: "Relatórios", icon: "chart" as const }] : []),
            ],
          },
        ];
  const sub = user.role === "owner" ? await prisma.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { periodEnd: "desc" } }) : null;
  const brand = (
    <div className="min-w-0">
      <Link href={user.role === "owner" ? "/painel" : "/painel/agenda"} className="block truncate font-semibold tracking-tight text-zinc-900">
        {tenant.name}
      </Link>
      {tenant.status === "active" ? (
        <a href={`/${tenant.slug}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Página no ar · ver
          <Icon name="external" className="size-3" />
        </a>
      ) : (
        <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden /> Página não publicada
        </span>
      )}
    </div>
  );
  const footer = (
    <div className="space-y-0.5">
      {!support && <FooterLink href="/conta" icon="user">Minha conta</FooterLink>}
      {support && (
        <form action={endSupportAction}>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50">
            <Icon name="building" className="size-[18px]" /> Voltar ao admin
          </button>
        </form>
      )}
      <form action={logout}>
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
          <Icon name="logout" className="size-[18px] text-zinc-400" /> Sair
        </button>
      </form>
    </div>
  );
  return (
    <SideNav groups={nav} brand={brand} footer={footer}>
      {support && (
        <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-violet-700 px-4 py-2 text-sm text-white">
          <span>
            Gerenciando <strong>{tenant.name}</strong> como superadmin
            {tenant.status !== "active" && <> · página {tenant.status === "suspended" ? "suspensa" : "não publicada"}</>}
            <span className="hidden sm:inline"> · alterações ficam registradas com o seu usuário</span>
          </span>
          <form action={endSupportAction}>
            <button className="rounded-md bg-white/20 px-2.5 py-1 font-medium hover:bg-white/30">← Voltar ao admin</button>
          </form>
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
      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </SideNav>
  );
}
