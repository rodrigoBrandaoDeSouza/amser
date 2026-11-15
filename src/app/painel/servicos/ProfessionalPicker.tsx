"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

/**
 * Seleção de quem faz o serviço: cartões grandes (bons para o dedo no celular),
 * com inicial colorida, marca de seleção, contador, "todos/limpar" e busca
 * quando a equipe é grande. Envia os ids como vários campos "professionals"
 * para a server action (mesmo formato das antigas caixinhas).
 */

const PALETTE = ["#e11d48", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#ca8a04", "#ea580c", "#db2777", "#4f46e5", "#0d9488"];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ProfessionalPicker({
  pros,
  defaultSelected,
  name = "professionals",
}: {
  pros: { id: string; displayName: string }[];
  defaultSelected: string[];
  name?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected.filter((id) => pros.some((p) => p.id === id))));
  const [query, setQuery] = useState("");
  const labelId = useId();
  const showSearch = pros.length > 8;
  const visible = useMemo(() => (query ? pros.filter((p) => norm(p.displayName).includes(norm(query))) : pros), [pros, query]);
  const allSelected = selected.size === pros.length && pros.length > 0;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!pros.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
        Ninguém na equipe ainda.{" "}
        <Link href="/painel/equipe" className="font-medium text-zinc-900 underline">
          Cadastrar profissionais
        </Link>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span id={labelId} className="text-sm font-medium text-zinc-800">
          Quem faz este serviço
          <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-600" aria-live="polite">
            {selected.size} de {pros.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setSelected(allSelected ? new Set() : new Set(pros.map((p) => p.id)))}
          className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        >
          {allSelected ? "Limpar" : "Selecionar todos"}
        </button>
      </div>

      {showSearch && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar profissional…"
          aria-label="Buscar profissional"
          className="mb-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
      )}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(p.id)}
                className={
                  "relative flex min-h-14 w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition active:scale-[0.98] " +
                  (on ? "border-zinc-900 bg-zinc-900/[0.04] ring-1 ring-zinc-900" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50")
                }
              >
                <span
                  aria-hidden
                  className={"flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white transition " + (on ? "" : "opacity-50 grayscale")}
                  style={{ background: colorFor(p.id) }}
                >
                  {initials(p.displayName)}
                </span>
                <span className={"min-w-0 flex-1 truncate " + (on ? "font-medium text-zinc-900" : "text-zinc-600")}>{p.displayName}</span>
                <span
                  aria-hidden
                  className={
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition " +
                    (on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-transparent")
                  }
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              </button>
            </li>
          );
        })}
        {!visible.length && <li className="col-span-full py-3 text-center text-sm text-zinc-500">Ninguém com esse nome.</li>}
      </ul>

      {selected.size === 0 && (
        <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Sem ninguém marcado, este serviço não aparece na página de agendamento.
        </p>
      )}

      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </div>
  );
}
