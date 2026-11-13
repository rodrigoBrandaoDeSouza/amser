"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_TEXT: Record<string, string> = {
  aguardando_sinal: "Aguardando pagamento do sinal",
  pendente: "Agendado",
  confirmado: "Confirmado",
  concluido: "Atendimento concluído",
  cancelado: "Cancelado",
  nao_compareceu: "Não compareceu",
  expirado: "Reserva expirada — o Pix não foi pago a tempo",
};

function icsHref(title: string, startsAt: string, endsAt: string, location: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Amser//PT-BR",
    "BEGIN:VEVENT",
    `UID:${f(startsAt)}-${Math.random().toString(36).slice(2)}@amser`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(startsAt)}`,
    `DTEND:${f(endsAt)}`,
    `SUMMARY:${title.replace(/[,;\n]/g, " ")}`,
    `LOCATION:${location.replace(/[,;\n]/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function googleHref(title: string, startsAt: string, endsAt: string, location: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${f(startsAt)}/${f(endsAt)}`, location });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function ManageAppointment(props: {
  token: string;
  slug: string;
  serviceId: string;
  professionalId: string;
  status: string;
  confirmedPresence: boolean;
  startsAt: string;
  endsAt: string;
  title: string;
  location: string;
  canChange: boolean;
  cancelLimitHours: number;
  policy: string;
  pix: { amount: string; copyPaste: string; qrDataUrl: string | null; expiresAt: string } | null;
  depositPaid: string | null;
  today: string;
  timeZone: string;
  devSimulate: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(props.status);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [remaining, setRemaining] = useState<number | null>(null);

  // Polling enquanto aguarda o Pix.
  useEffect(() => {
    if (status !== "aguardando_sinal") return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/public/appointments/${props.token}`);
      if (r.ok) {
        const j = await r.json();
        if (j.status !== "aguardando_sinal") {
          setStatus(j.status);
          router.refresh();
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [status, props.token, router]);

  useEffect(() => {
    if (!props.pix || status !== "aguardando_sinal") return;
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(props.pix!.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props.pix, status]);

  async function act(body: object, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/public/appointments/${props.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? "Não foi possível concluir");
      setMsg(j.depositRetained ? `${done} O sinal fica retido conforme a política.` : done);
      setMode("view");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  const active = ["pendente", "confirmado"].includes(status);

  return (
    <div className="mt-6 space-y-5">
      <div role="status" aria-live="polite" className="text-lg font-semibold">
        {STATUS_TEXT[status] ?? status}
        {status === "confirmado" && props.depositPaid && <span className="pub-muted block text-sm font-normal">Sinal de {props.depositPaid} recebido.</span>}
      </div>
      {msg && <p className="pub-card p-3 text-sm">{msg}</p>}

      {status === "aguardando_sinal" && props.pix && (
        <section className="pub-card space-y-3 p-4" data-style="border">
          <p>
            Pague o sinal de <strong>{props.pix.amount}</strong> via Pix para garantir seu horário.
            {remaining !== null && (
              <span className="pub-muted block text-sm">
                {remaining > 0 ? `O horário fica reservado por mais ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.` : "Tempo esgotado."}
              </span>
            )}
          </p>
          {props.pix.qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.pix.qrDataUrl} alt="QR Code do Pix" className="mx-auto h-56 w-56 bg-white p-2" />
          )}
          <button
            type="button"
            className="pub-btn w-full px-4 py-3 font-semibold"
            onClick={async () => {
              await navigator.clipboard.writeText(props.pix!.copyPaste);
              setCopied(true);
            }}
          >
            {copied ? "Código copiado!" : "Copiar código Pix (copia e cola)"}
          </button>
          {props.devSimulate && (
            <button
              type="button"
              className="pub-btn w-full px-4 py-2 text-sm"
              data-variant="outline"
              onClick={async () => {
                await fetch("/api/dev/simulate-pix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: props.token }) });
                router.refresh();
                setStatus("confirmado");
              }}
            >
              [dev] Simular pagamento do Pix
            </button>
          )}
        </section>
      )}

      {active && mode === "view" && (
        <div className="space-y-3">
          {status === "pendente" && !props.confirmedPresence && (
            <button type="button" disabled={busy} className="pub-btn w-full px-4 py-3 font-semibold" onClick={() => act({ action: "confirm" }, "Presença confirmada. Até lá!")}>
              Confirmar presença
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a className="pub-btn px-3 py-2 text-center text-sm" data-variant="outline" href={googleHref(props.title, props.startsAt, props.endsAt, props.location)} target="_blank" rel="noopener noreferrer">
              Google Agenda
            </a>
            <a className="pub-btn px-3 py-2 text-center text-sm" data-variant="outline" href={icsHref(props.title, props.startsAt, props.endsAt, props.location)} download="agendamento.ics">
              Outro calendário
            </a>
          </div>
          {props.canChange ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="pub-btn px-3 py-2 text-sm" data-variant="outline" onClick={() => setMode("reschedule")}>
                Remarcar
              </button>
              <button type="button" className="pub-btn px-3 py-2 text-sm" data-variant="outline" onClick={() => setMode("cancel")}>
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <p className="pub-muted text-sm">
                Remarcações online só até {props.cancelLimitHours}h antes. Para mudanças, fale com o estabelecimento.
              </p>
              <button type="button" className="pub-btn w-full px-3 py-2 text-sm" data-variant="outline" onClick={() => setMode("cancel")}>
                Cancelar mesmo assim
              </button>
            </>
          )}
        </div>
      )}

      {active && mode === "cancel" && (
        <section className="pub-card space-y-3 p-4" data-style="border">
          <p className="text-sm">{props.policy}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="pub-btn px-3 py-2 text-sm" data-variant="outline" onClick={() => setMode("view")}>
              Voltar
            </button>
            <button type="button" disabled={busy} className="pub-btn px-3 py-2 text-sm" onClick={() => act({ action: "cancel" }, "Agendamento cancelado.")}>
              Confirmar cancelamento
            </button>
          </div>
        </section>
      )}

      {active && mode === "reschedule" && (
        <Reschedule {...props} busy={busy} onCancel={() => setMode("view")} onPick={(iso) => act({ action: "reschedule", startsAt: iso }, "Horário alterado!")} />
      )}

      {(status === "expirado" || status === "cancelado") && (
        <a href={`/${props.slug}`} className="pub-btn inline-flex px-4 py-3 font-semibold">
          Fazer novo agendamento
        </a>
      )}
    </div>
  );
}

function Reschedule(props: {
  slug: string;
  serviceId: string;
  professionalId: string;
  today: string;
  busy: boolean;
  onCancel: () => void;
  onPick: (iso: string) => void;
}) {
  const days = useMemo(() => {
    const [y, m, d] = props.today.split("-").map(Number);
    return Array.from({ length: 21 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
      return {
        iso: dt.toISOString().slice(0, 10),
        label: new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(dt),
      };
    });
  }, [props.today]);
  const [date, setDate] = useState(props.today);
  const [slots, setSlots] = useState<{ startsAt: string; label: string }[] | null>(null);

  useEffect(() => {
    setSlots(null);
    const qs = new URLSearchParams({ serviceId: props.serviceId, professionalId: props.professionalId, date });
    fetch(`/api/public/${props.slug}/availability?${qs}`)
      .then((r) => r.json())
      .then((j) => setSlots(j.slots ?? []))
      .catch(() => setSlots([]));
  }, [date, props.serviceId, props.professionalId, props.slug]);

  return (
    <section className="pub-card space-y-3 p-4" data-style="border">
      <h2 className="font-semibold">Escolha o novo horário</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {days.map((d) => (
          <button key={d.iso} type="button" aria-pressed={d.iso === date} onClick={() => setDate(d.iso)} className="pub-chip shrink-0 px-3 py-2 text-sm capitalize">
            {d.label}
          </button>
        ))}
      </div>
      {slots === null ? (
        <p className="pub-muted text-sm">Carregando…</p>
      ) : slots.length === 0 ? (
        <p className="pub-muted text-sm">Sem horários neste dia.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {slots.map((s) => (
            <button key={s.startsAt} type="button" disabled={props.busy} className="pub-chip py-2 text-sm tabular-nums" onClick={() => props.onPick(s.startsAt)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="pub-muted text-sm underline" onClick={props.onCancel}>
        Voltar
      </button>
    </section>
  );
}
