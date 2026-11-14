"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Indicador de carregamento. Herda a cor do texto. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx("spinner size-4 shrink-0", className)} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Bloco cinza animado que ocupa o lugar do conteúdo enquanto ele carrega. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cx("skeleton", className)} style={style} />;
}

export function Button({
  variant = "primary",
  className,
  loading,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  // Dentro de um <form action={serverAction}>, o botão clicado mostra o spinner sozinho
  // e os demais ficam desabilitados até a resposta.
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  const ref = useRef(pending);
  useEffect(() => {
    if (ref.current && !pending) setClicked(false);
    ref.current = pending;
  }, [pending]);
  const isSubmit = (props.type ?? "submit") === "submit";
  const busy = loading ?? (pending && clicked);
  return (
    <button
      {...props}
      onClick={(e) => {
        if (isSubmit) setClicked(true);
        props.onClick?.(e);
      }}
      disabled={busy || (isSubmit && pending) || props.disabled}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
        busy && "disabled:opacity-80",
        variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-700",
        variant === "secondary" && "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        variant === "ghost" && "text-zinc-700 hover:bg-zinc-100",
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

