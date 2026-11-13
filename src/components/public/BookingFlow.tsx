"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicService, PublicUnit } from "@/lib/public";

const brl = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);

type Step = "unit" | "service" | "professional" | "time" | "details" | "waitlist" | "waitlisted";

interface Slot {
  startsAt: string;
  label: string;
}

function nextDays(today: string, n: number) {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
    return {
      iso: dt.toISOString().slice(0, 10),
      wd: new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(dt).replace(".", ""),
      dm: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(dt),
    };
  });
}

export function BookingFlow({
  slug,
  services,
  units = [],
  policy,
  disabled,
  today,
  cardStyle = "border",
  waitlistEnabled = false,
  couponsEnabled = true,
}: {
  slug: string;
  services: PublicService[];
  units?: PublicUnit[];
  policy: string;
  disabled?: boolean;
  today: string;
  timeZone: string;
  cardStyle?: string;
  waitlistEnabled?: boolean;
  couponsEnabled?: boolean;
}) {
  const router = useRouter();
  const multiUnit = units.length > 1;
  const [step, setStep] = useState<Step>(multiUnit ? "unit" : "service");
  const [unitId, setUnitId] = useState<string | null>(multiUnit ? null : (units[0]?.id ?? null));
  const [service, setService] = useState<PublicService | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", consent: true });
  const [coupon, setCoupon] = useState({ code: "", applied: null as null | { code: string; discountCents: number; finalPriceCents: number; depositCents: number }, error: "" });

  const days = useMemo(() => nextDays(today, 21), [today]);
  const visibleServices = useMemo(
    () =>
      services
        .map((s) => ({ ...s, professionals: unitId && multiUnit ? s.professionals.filter((p) => p.unitId === unitId) : s.professionals }))
        .filter((s) => s.professionals.length > 0),
    [services, unitId, multiUnit],
  );
  const pros = service?.professionals ?? [];

  useEffect(() => {
    if (step !== "time" || !service) return;
    const ctrl = new AbortController();
    setSlots(null);
    setSlot(null);
    setError(null);
    const qs = new URLSearchParams({ serviceId: service.id, date, ...(professionalId ? { professionalId } : {}), ...(unitId && multiUnit ? { unitId } : {}) });
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
  }, [step, service, professionalId, date, slug, unitId, multiUnit]);

  if (!services.length) return <p className="pub-muted">Nenhum serviço disponível para agendamento online no momento.</p>;

  const customer = () => ({ name: form.name, phone: form.phone, email: form.email || null, consentWhatsapp: form.consent });

  async function applyCoupon() {
    if (!service || !coupon.code.trim()) return;
    setCoupon((c) => ({ ...c, error: "" }));
    const r = await fetch(`/api/public/${slug}/coupon?${new URLSearchParams({ code: coupon.code, serviceId: service.id })}`);
    const j = await r.json();
    if (!r.ok) setCoupon((c) => ({ ...c, applied: null, error: j.message ?? "Cupom inválido" }));
    else setCoupon((c) => ({ ...c, applied: j, error: "" }));
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
          unitId: multiUnit ? unitId : null,
          startsAt: slot.startsAt,
          couponCode: coupon.applied?.code ?? null,
          customer: customer(),
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

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!service || disabled) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/${slug}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, professionalId, unitId: multiUnit ? unitId : null, date, customer: { ...customer(), consentWhatsapp: true } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? "Não foi possível entrar na lista");
      setStep("waitlisted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="pub-muted mb-3 text-sm underline">
      ← Voltar
    </button>
  );
  const order: Step[] = [...(multiUnit ? (["unit"] as Step[]) : []), "service", "professional", "time", "details"];
  const stepIdx = Math.max(0, order.indexOf(step === "waitlist" || step === "waitlisted" ? "time" : step));
  const price = coupon.applied?.finalPriceCents ?? service?.priceCents ?? 0;
  const deposit = coupon.applied?.depositCents ?? service?.depositCents ?? 0;
  const dayLabel = `${days.find((d) => d.iso === date)?.wd}, ${days.find((d) => d.iso === date)?.dm}`;
  const personalFields = (
    <>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Seu nome</span>
        <input required minLength={2} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="pub-chip w-full bg-transparent px-3 py-2.5" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">WhatsApp (com DDD)</span>
        <input required inputMode="tel" autoComplete="tel" placeholder="(11) 98888-7777" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="pub-chip w-full bg-transparent px-3 py-2.5" />
      </label>
    </>
  );

  return (
    <div>
      {step !== "waitlisted" && (
        <p className="pub-muted mb-3 text-xs font-medium uppercase tracking-wide" aria-live="polite">
          Passo {stepIdx + 1} de {order.length}
        </p>
      )}

      {step === "unit" && (
        <div className="grid gap-3">
          <h3 className="font-semibold">Qual unidade?</h3>
          {units.map((u) => (
            <button
              key={u.id}
              type="button"
              className="pub-card p-4 text-left"
              data-style={cardStyle}
              onClick={() => {
                setUnitId(u.id);
                setService(null);
                setStep("service");
              }}
            >
              <div className="font-semibold">{u.name}</div>
              {u.address && <div className="pub-muted text-sm">{u.address}</div>}
            </button>
          ))}
        </div>
      )}

      {step === "service" && (
        <div>
          {multiUnit && back("unit")}
          <ul className="space-y-3">
            {visibleServices.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="pub-card block w-full p-4 text-left"
                  data-style={cardStyle}
                  onClick={() => {
                    setService(s);
                    setProfessionalId(null);
                    setCoupon({ code: "", applied: null, error: "" });
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
        </div>
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
              <button key={d.iso} type="button" role="option" aria-selected={d.iso === date} aria-pressed={d.iso === date} onClick={() => setDate(d.iso)} className="pub-chip shrink-0 px-3 py-2 text-center text-sm">
                <div className="capitalize">{d.wd}</div>
                <div className="font-semibold">{d.dm}</div>
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mb-3 text-sm font-medium">{error}</p>}
          {slots === null && !error && <p className="pub-muted text-sm">Carregando horários…</p>}
          {slots?.length === 0 && (
            <div className="space-y-3">
              <p className="pub-muted text-sm">Sem horários neste dia.</p>
              {waitlistEnabled && (
                <button type="button" className="pub-btn px-4 py-2 text-sm font-semibold" data-variant="outline" onClick={() => setStep("waitlist")}>
                  Avise-me se abrir um horário
                </button>
              )}
            </div>
          )}
          {slots && slots.length > 0 && (
            <>
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
              {waitlistEnabled && (
                <button type="button" className="pub-muted mt-4 text-sm underline" onClick={() => setStep("waitlist")}>
                  Nenhum horário bom? Entrar na lista de espera deste dia
                </button>
              )}
            </>
          )}
        </div>
      )}

      {step === "waitlist" && service && (
        <form onSubmit={joinWaitlist} className="space-y-4">
          {back("time")}
          <div className="pub-card p-4 text-sm" data-style={cardStyle}>
            <div className="font-semibold">Lista de espera — {service.name}</div>
            <div className="pub-muted">Se abrir um horário em {dayLabel}, avisamos você pelo WhatsApp. Quem reservar primeiro garante.</div>
          </div>
          {personalFields}
          {error && <p role="alert" className="text-sm font-medium">{error}</p>}
          <button type="submit" disabled={loading || disabled} className="pub-btn w-full px-4 py-3 text-base font-semibold">
            {disabled ? "Desativado na prévia" : loading ? "Enviando…" : "Entrar na lista de espera"}
          </button>
        </form>
      )}

      {step === "waitlisted" && (
        <div className="pub-card space-y-2 p-4" data-style={cardStyle} role="status">
          <div className="font-semibold">Você está na lista de espera ✓</div>
          <p className="pub-muted text-sm">Se um horário abrir em {dayLabel}, você recebe um link no WhatsApp para reservar.</p>
          <button type="button" className="pub-muted text-sm underline" onClick={() => setStep("time")}>
            Ver outros dias
          </button>
        </div>
      )}

      {step === "details" && service && slot && (
        <form onSubmit={submit} className="space-y-4">
          {back("time")}
          <div className="pub-card p-4 text-sm" data-style={cardStyle}>
            <div className="font-semibold">{service.name}</div>
            <div className="pub-muted">
              {dayLabel} às {slot.label} · {service.durationMinutes} min ·{" "}
              {coupon.applied ? (
                <>
                  <s>{brl(service.priceCents)}</s> {brl(price)}
                </>
              ) : (
                brl(price)
              )}
            </div>
          </div>
          {personalFields}
          <label className="block">
            <span className="mb-1 block text-sm font-medium">E-mail (opcional)</span>
            <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="pub-chip w-full bg-transparent px-3 py-2.5" />
          </label>
          {couponsEnabled && (
          <div>
            <span className="mb-1 block text-sm font-medium">Cupom (opcional)</span>
            <div className="flex gap-2">
              <input
                value={coupon.code}
                onChange={(e) => setCoupon({ code: e.target.value.toUpperCase(), applied: null, error: "" })}
                className="pub-chip w-full bg-transparent px-3 py-2.5 uppercase"
                maxLength={30}
                aria-label="Código do cupom"
              />
              <button type="button" onClick={applyCoupon} className="pub-btn shrink-0 px-4 text-sm" data-variant="outline">
                Aplicar
              </button>
            </div>
            {coupon.applied && <p className="mt-1 text-sm">Cupom {coupon.applied.code}: −{brl(coupon.applied.discountCents)}</p>}
            {coupon.error && <p className="mt-1 text-sm" role="alert">{coupon.error}</p>}
          </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1" />
            <span>Quero receber confirmação e lembretes deste agendamento pelo WhatsApp.</span>
          </label>
          <div className="pub-muted rounded border border-current/10 p-3 text-xs">
            <strong>Política de cancelamento:</strong> {policy}
          </div>
          {error && <p role="alert" className="text-sm font-medium">{error}</p>}
          <button type="submit" disabled={loading || disabled} className="pub-btn w-full px-4 py-3 text-base font-semibold">
            {disabled ? "Agendamento desativado na prévia" : loading ? "Reservando…" : deposit > 0 ? `Reservar e pagar sinal de ${brl(deposit)}` : "Confirmar agendamento"}
          </button>
          {deposit > 0 && <p className="pub-muted text-center text-xs">Se você tiver crédito com a gente, ele é descontado do sinal automaticamente.</p>}
        </form>
      )}
    </div>
  );
}
