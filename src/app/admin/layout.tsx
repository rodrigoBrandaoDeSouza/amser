import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperadmin, destroySession } from "@/lib/auth/session";
import { SideNav, FooterLink, type NavGroup } from "@/components/nav/SideNav";
import { Icon } from "@/components/nav/icons";

export const metadata = { robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

const NAV: NavGroup[] = [
  { items: [{ href: "/admin", label: "Empresas", icon: "building", exact: true }] },
  {
    title: "Criar",
    items: [
      { href: "/admin/prospects/novo", label: "Nova prévia (prospect)", icon: "eye" },
      { href: "/admin/empresas/nova", label: "Nova empresa", icon: "plus" },
    ],
  },
  { title: "Plataforma", items: [{ href: "/admin/flags", label: "Feature flags", icon: "flag" }] },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperadmin();
  const brand = (
    <div className="min-w-0">
      <Link href="/admin" className="flex items-center gap-2 font-semibold tracking-tight text-zinc-900">
        Amser <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">admin</span>
      </Link>
      <div className="mt-1 truncate text-xs text-zinc-500">{user.email}</div>
    </div>
  );
  const footer = (
    <div className="space-y-0.5">
      <FooterLink href="/conta" icon="user">Minha conta</FooterLink>
      <form action={logout}>
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
          <Icon name="logout" className="size-[18px] text-zinc-400" /> Sair
        </button>
      </form>
    </div>
  );
  return (
    <SideNav groups={NAV} brand={brand} footer={footer}>
      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </SideNav>
  );
}
