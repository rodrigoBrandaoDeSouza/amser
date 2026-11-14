"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { embeddedSignupAction } from "../actions-whatsapp";

/**
 * "Conectar meu WhatsApp" — cadastro integrado da Meta (Embedded Signup v5, ADR 0015).
 * Na v5 a coexistência vem ligada: quem já usa o app WhatsApp Business escolhe o próprio número
 * e continua usando o app no celular.
 *
 * A janela da Meta devolve duas coisas por caminhos diferentes:
 *  - postMessage WA_EMBEDDED_SIGNUP com o evento e os IDs (phone_number_id, waba_id, business_id);
 *  - o callback do FB.login com o código (vale 30 s).
 * Quando as duas chegam, enviamos ao servidor, que faz todo o resto.
 */

type SessionInfo = { event: string; phoneNumberId: string; wabaId: string; businessId: string | null };

declare global {
  interface Window {
    FB?: {
      init(o: object): void;
      login(cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: object): void;
    };
    fbAsyncInit?: () => void;
  }
}

const isFacebookOrigin = (origin: string) => {
  try {
    const h = new URL(origin).hostname;
    return h === "facebook.com" || h.endsWith(".facebook.com");
  } catch {
    return false;
  }
};

function loadSdk(appId: string, graphVersion: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Não foi possível carregar o Facebook. Verifique se algum bloqueador está ativo."));
    document.body.appendChild(s);
  });
}

export function ConnectWhatsappButton({
  appId,
  configId,
  graphVersion,
  simulate,
  label = "Conectar meu WhatsApp",
}: {
  appId: string;
  configId: string;
  graphVersion: string;
  /** Provider mock (dev): simula a janela da Meta. */
  simulate: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "popup" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; warnings: string[] } | null>(null);
  const session = useRef<SessionInfo | null>(null);
  const code = useRef<string | null>(null);

  async function finish() {
    if (!session.current || !code.current) return;
    const payload = { ...session.current, code: code.current };
    session.current = null;
    code.current = null;
    setState("saving");
    const r = await embeddedSignupAction(payload);
    setState("idle");
    if (r.ok) {
      setDone({ message: r.message, warnings: r.warnings });
      router.refresh();
    } else setError(r.error);
  }

  useEffect(() => {
    if (simulate) return;
    const onMessage = (event: MessageEvent) => {
      if (!isFacebookOrigin(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      const ev = String(data.event ?? "");
      if (ev === "CANCEL") {
        setState("idle");
        return;
      }
      if (ev === "ERROR") {
        setState("idle");
        setError(`A Meta informou um erro: ${data.data?.error_message ?? "tente novamente"}`);
        return;
      }
      if (ev === "FINISH_ONLY_WABA") {
        setState("idle");
        setError("A conta foi criada, mas nenhum número foi escolhido. Clique em conectar de novo e escolha o número.");
        return;
      }
      if (ev.startsWith("FINISH")) {
        session.current = {
          event: ev,
          phoneNumberId: String(data.data?.phone_number_id ?? ""),
          wabaId: String(data.data?.waba_id ?? ""),
          businessId: data.data?.business_id ? String(data.data.business_id) : null,
        };
        void finish();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulate]);

  async function start() {
    setError(null);
    setDone(null);
    if (simulate) {
      // Dev: simula a janela da Meta com um número que continua no app (coexistência).
      setState("popup");
      await new Promise((r) => setTimeout(r, 600));
      const rnd = () => String(Math.floor(1e9 + Math.random() * 9e9));
      session.current = { event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", phoneNumberId: rnd(), wabaId: rnd(), businessId: rnd() };
      code.current = `mock-${Date.now()}`;
      return finish();
    }
    try {
      setState("popup");
      await loadSdk(appId, graphVersion);
      window.FB!.login(
        (response) => {
          const c = response.authResponse?.code;
          if (!c) {
            setState((s) => (s === "popup" ? "idle" : s));
            return;
          }
          code.current = c;
          void finish();
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          // v5: o fluxo oferece "usar o número do app WhatsApp Business" (coexistência) por padrão.
          extras: { setup: {}, version: "v5" },
        },
      );
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Não foi possível abrir a janela da Meta");
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={start} loading={state !== "idle"} className="w-full sm:w-auto">
        {state === "popup" ? "Aguardando a janela da Meta…" : state === "saving" ? "Conectando e validando…" : label}
      </Button>
      {simulate && <p className="text-xs text-amber-700">Modo de teste: a janela da Meta é simulada.</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {done && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {done.message}
          {done.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
              {done.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
