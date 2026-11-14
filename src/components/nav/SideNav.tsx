"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Spinner } from "../Button";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Ativo só na rota exata (ex.: "/painel"), não nas filhas. */
  exact?: boolean;
}
export interface NavGroup {
  title?: string;
  items: NavItem[];
}

const isActive = (pathname: string, item: NavItem) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");

/** Indicador de navegação em andamento: barra no topo + spinner no item clicado. */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span className="nav-progress" role="progressbar" aria-label="Carregando página" />
      <Spinner className="ml-auto size-3.5 text-zinc-400" />
    </>
  );
}

function NavLinks({ groups, pathname, onNavigate }: { groups: NavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Menu principal" className="space-y-5">
      {groups.map((g, i) => (
        <div key={g.title ?? i}>
          {g.title && <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{g.title}</div>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
                      (active ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900")
                    }
                  >
                    <Icon name={item.icon} className={"size-[18px] " + (active ? "text-white" : "text-zinc-400 group-hover:text-zinc-700")} />
                    <span className="truncate">{item.label}</span>
                    <PendingIndicator />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Menu lateral do painel/admin. Desktop: barra fixa à esquerda.
 * Celular: barra no topo com o nome da seção atual e um menu deslizante.
 */
export function SideNav({ groups, brand, footer, children }: { groups: NavGroup[]; brand: ReactNode; footer: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = groups.flatMap((g) => g.items).find((i) => isActive(pathname, i));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_1fr]">
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-zinc-200 bg-white lg:flex">
        <div className="border-b border-zinc-100 px-4 py-4">{brand}</div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <NavLinks groups={groups} pathname={pathname} />
        </div>
        <div className="border-t border-zinc-100 px-2 py-3">{footer}</div>
      </aside>

      {/* Celular */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200 bg-white/95 px-3 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-m-1 rounded-lg p-2 text-zinc-700 hover:bg-zinc-100"
          aria-label="Abrir menu"
          aria-expanded={open}
          aria-controls="menu-movel"
        >
          <Icon name="menu" className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-900">{current?.label ?? "Menu"}</div>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="menu-movel">
          <button type="button" className="absolute inset-0 bg-zinc-900/40 fade-in" aria-label="Fechar menu" onClick={() => setOpen(false)} />
          <div className="fade-in absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-white shadow-xl">
            <div className="flex items-start gap-2 border-b border-zinc-100 px-4 py-4">
              <div className="min-w-0 flex-1">{brand}</div>
              <button type="button" onClick={() => setOpen(false)} className="-m-1 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" aria-label="Fechar menu">
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-4">
              <NavLinks groups={groups} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-zinc-100 px-2 py-3">{footer}</div>
          </div>
        </div>
      )}

      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Item do rodapé do menu (Minha conta, Sair). */
export function FooterLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">
      <Icon name={icon} className="size-[18px] text-zinc-400" />
      {children}
      <PendingIndicator />
    </Link>
  );
}
