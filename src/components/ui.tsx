import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export { Button, Spinner, Skeleton } from "./Button";

export function LinkButton({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" }) {
  return (
    <Link
      {...props}
      className={cx(
        "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition",
        variant === "primary" ? "bg-zinc-900 text-white hover:bg-zinc-700" : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, className)} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-zinc-200 bg-white p-4 sm:p-5", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-zinc-900">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Badge({ tone = "zinc", children }: { tone?: "zinc" | "green" | "amber" | "red" | "blue"; children: ReactNode }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  };
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

/** Mensagens de retorno das server actions (?ok= / ?erro=). */
export function Flash({ ok, erro }: { ok?: string; erro?: string }) {
  if (!ok && !erro) return null;
  return (
    <div
      role={erro ? "alert" : "status"}
      className={cx(
        "mb-4 rounded-lg border px-3 py-2 text-sm",
        erro ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      {erro ?? ok}
    </div>
  );
}

export const STATUS_LABEL: Record<string, { label: string; tone: "zinc" | "green" | "amber" | "red" | "blue" }> = {
  aguardando_sinal: { label: "Aguardando sinal", tone: "amber" },
  pendente: { label: "Pendente", tone: "blue" },
  confirmado: { label: "Confirmado", tone: "green" },
  concluido: { label: "Concluído", tone: "zinc" },
  cancelado: { label: "Cancelado", tone: "red" },
  nao_compareceu: { label: "Faltou", tone: "red" },
  expirado: { label: "Expirado", tone: "zinc" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, tone: "zinc" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
