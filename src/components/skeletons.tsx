import { Skeleton } from "./Button";

/** Esqueletos com o formato das telas, para a troca de página parecer imediata. */

export function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-[60vw]" />
      </div>
      {action && <Skeleton className="h-9 w-32" />}
    </div>
  );
}

export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
      <Skeleton className="mb-5 h-5 w-40" />
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5" style={{ width: `${70 - ((i * 13) % 35)}%` }} />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Página genérica do painel: título + indicadores + lista. */
export function PanelPageSkeleton() {
  return (
    <div role="status" aria-label="Carregando…" className="fade-in">
      <HeaderSkeleton />
      <div className="space-y-6">
        <StatsSkeleton />
        <CardSkeleton rows={5} />
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

/** Agenda: barra de datas + linhas de horário. */
export function AgendaSkeleton() {
  return (
    <div role="status" aria-label="Carregando agenda…" className="fade-in">
      <HeaderSkeleton />
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4" style={{ width: `${55 - ((i * 11) % 25)}%` }} />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">Carregando agenda…</span>
    </div>
  );
}
