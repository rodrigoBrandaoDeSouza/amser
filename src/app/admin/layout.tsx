import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSuperadmin, destroySession } from "@/lib/auth/session";

export const metadata = { robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperadmin();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-bold tracking-tight">
            Amser <span className="ml-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">admin</span>
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link href="/admin" className="hover:underline">Empresas</Link>
            <Link href="/admin/prospects/novo" className="hover:underline">Nova prévia</Link>
            <Link href="/admin/empresas/nova" className="hover:underline">Nova empresa</Link>
            <Link href="/admin/flags" className="hover:underline">Flags</Link>
            <Link href="/conta" className="hover:underline">Minha conta</Link>
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3 text-sm text-zinc-600">
            <span className="hidden sm:inline">{user.email}</span>
            <button className="hover:underline">Sair</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
