"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton, Spinner } from "../Button";

export function WaitlistOffer({ token, slug }: { token: string; slug: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: string; slots: { startsAt: string; label: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/public/waitlist/${token}`)
      .then((r) => r.json())
      .then((j) => setState({ status: j.status ?? "expired", slots: j.slots ?? [] }))
      .catch(() => setState({ status: "expired", slots: [] }));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function book(startsAt: string) {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/public/waitlist/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startsAt }) });
    const j = await r.json();
    if (r.ok) {
      router.push(`/a/${j.token}`);
      return;
    }
    setError(j.message ?? "Não foi possível reservar");
    setBusy(false);
    load();
  }

  if (!state)
    return (
      <div className="mt-6" role="status" aria-label="Carregando horários">
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
    );
  if (!["waiting", "offered"].includes(state.status)) {
    return (
      <div className="mt-6 space-y-3">
        <p>{state.status === "booked" ? "Você já reservou por esta oferta." : "Esta oferta não está mais disponível."}</p>
        <a href={`/${slug}`} className="pub-btn inline-flex px-4 py-3 font-semibold">Ver agenda</a>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      {error && <p role="alert" className="font-medium">{error}</p>}
      {state.slots.length === 0 ? (
        <>
          <p>Que pena — o horário já foi ocupado. Você continua na lista e avisamos se abrir outro.</p>
          <a href={`/${slug}`} className="pub-btn inline-flex px-4 py-3 font-semibold" data-variant="outline">Ver outros dias</a>
        </>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {state.slots.map((s) => (
            <button key={s.startsAt} type="button" disabled={busy} onClick={() => book(s.startsAt)} className="pub-chip py-2 text-sm font-medium tabular-nums">
              {s.label}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p className="pub-muted inline-flex items-center gap-2 text-sm" role="status">
          <Spinner /> Reservando…
        </p>
      )}
    </div>
  );
}
