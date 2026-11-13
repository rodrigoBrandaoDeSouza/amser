"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicService } from "@/lib/public";

const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);

type Step = "service" | "professional" | "time" | "details";

interface Slot {
  startsAt: string;
  label: string;
}

function nextDays(today: string, n: number, tz: string) {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
    const iso = dt.toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(dt).replace(".", "");
    const dm = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(dt);
    return { iso, wd, dm, tz };
  });
}

export function BookingFlow({
  slug,
  services,
  policy,
  disabled,
  today,
  timeZone,
  cardStyle = "border",
}: {
  slug: string;
  services: PublicService[];
  policy: string;
  disabled?: boolean;
  today: string;
  timeZone: string;
  cardStyle?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<PublicService | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", consent: true });

  const days = useMemo(() => nextDays(today, 21, timeZone), [today, timeZone]);
  const pros = service?.professionals ?? [];

  useEffect(() => {
    if (step !== "time" || !service) return;
    const ctrl = new AbortController();
    setSlots(null);
    setSlot(null);
    setError(null);
    const qs = new URLSearchParams({ serviceId: service.id, date, ...(professionalId ? { professionalId } : {}) });
    fetch(`/api/public/${slug}/availability?${qs}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? "Erro ao carregar horários");
        setSlots(j.slots);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctrl.abort();
  }, [step, service, professionalId, date, slug]);

  if (!services.length) {
    return <p className="pub-muted">Nenhum serviço disponível para agendamento online no momento.</p>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !slot || disabled) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/${slug}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          professionalId,
          startsAt: slot.startsAt,
          customer: { name: form.name, phone: form.phone, email: form.email || null, consentWhatsapp: form.consent },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "slot_taken" || j.error === "slot_unavailable") {
          setStep("time");
          setSlots(null);
        }
        throw new Error(j.message ?? "Não foi possível agendar");
      }
      router.push(`/a/${j.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setLoading(false);
    }
  }

  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="pub-muted mb-3 text-sm underline">
      ← Voltar
    </button>
  );

  const stepNumber = { service: 1, professional: 2, time: 3, details: 4 }[step];

  return (
    <div>
      <p className="pub-muted mb-3 text-xs font-medium uppercase tracking-wide" aria-live="polite">
        Passo {stepNumber} de 4
      </p>

      {step === "service" && (
        <ul className="space-y-3">
          {services.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="pub-card block w-full p-4 text-left"
                data-style={cardStyle}
                onClick={() => {
                  setService(s);
                  setProfessionalId(null);
                  setStep(s.professionals.length > 1 ? "professional" : "time");
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    {s.description && <div className="pub-muted mt-0.5 text-sm">{s.description}</div>}
                    <div className="pub-muted mt-1 text-sm">{s.durationMinutes} min</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{brl(s.priceCents)}</div>
                    {s.depositCents > 0 && <div className="pub-muted text-xs">sinal {brl(s.depositCents)}</div>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === "professional" && service && (
        <div>
          {back("service")}
          <h3 className="mb-3 font-semibold">Com quem?</h3>
          <div className="grid gap-2">
            {[{ id: null, name: "Qualquer profissional disponível" }, ...pros].map((p) => (
              <button
                key={p.id ?? "any"}
                type="button"
                className="pub-card p-4 text-left font-medium"
                data-style={cardStyle}
                onClick={() => {
                  setProfessionalId(p.id);
                  setStep("time");
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "time" && service && (
        <div>
          {back(pros.length > 1 ? "professional" : "service")}
          <h3 className="mb-3 font-semibold">Escolha o dia e o horário</h3>
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-2" role="listbox" aria-label="Dias">
            {days.map((d) => (
              <button
                key={d.iso}
                type="button"
                role="option"
                aria-selected={d.iso === date}
                aria-pressed={d.iso === date}
                onClick={() => setDate(d.iso)}
                className="pub-chip shrink-0 px-3 py-2 text-center text-sm"
              >
                <div className="capitalize">{d.wd}</div>
                <div className="font-semibold">{d.dm}</div>
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mb-3 text-sm font-medium">{error}</p>}
          {slots === null && !error && <p className="pub-muted text-sm">Carregando horários…</p>}
          {slots?.length === 0 && <p className="pub-muted text-sm">Sem horários neste dia. Tente outra data.</p>}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {slots.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  aria-pressed={slot?.startsAt === s.startsAt}
                  className="pub-chip py-2 text-sm font-medium tabular-nums"
                  onClick={() => {
                    setSlot(s);
                    setStep("details");
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "details" && service && slot && (
        <form onSubmit={submit} className="space-y-4">
          {back("time")}
          <div className="pub-card p-4 text-sm" data-style={cardStyle}>
            <div className="font-semibold">{service.name}</div>
            <div className="pub-muted">
              {days.find((d) => d.iso === date)?.wd}, {days.find((d) => d.iso === date)?.dm} às {slot.label} ·{" "}
              {service.durationMinutes} min · {brl(service.priceCents)}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Seu nome</span>
            <input
              required
              minLength={2}
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="pub-chip w-full bg-transparent px-3 py-2.5"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">WhatsApp (com DDD)</span>
            <input
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 98888-7777"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="pub-chip w-full bg-transparent px-3 py-2.5"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">E-mail (opcional)</span>
            <input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="pub-chip w-full bg-transparent px-3 py-2.5"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1" />
            <span>Quero receber confirmação e lembretes deste agendamento pelo WhatsApp.</span>
          </label>
          <div className="pub-muted rounded border border-current/10 p-3 text-xs">
            <strong>Política de cancelamento:</strong> {policy}
          </div>
          {error && <p role="alert" className="text-sm font-medium">{error}</p>}
          <button type="submit" disabled={loading || disabled} className="pub-btn w-full px-4 py-3 text-base font-semibold">
            {disabled
              ? "Agendamento desativado na prévia"
              : loading
                ? "Reservando…"
                : service.depositCents > 0
                  ? `Reservar e pagar sinal de ${brl(service.depositCents)}`
                  : "Confirmar agendamento"}
          </button>
        </form>
      )}
    </div>
  );
}
