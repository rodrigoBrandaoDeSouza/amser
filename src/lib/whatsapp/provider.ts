import { env } from "../env";
import { hmacSha256Hex, safeEqual } from "../crypto";

/**
 * Camada de provedores de WhatsApp (§11). Prioridade: Cloud API oficial da Meta.
 * Mensagens iniciadas pela empresa usam SEMPRE templates aprovados.
 */
export interface SendTemplateInput {
  phoneNumberId: string | null;
  accessToken: string | null;
  toE164: string;
  templateName: string;
  language: string;
  bodyParams: string[];
  /** Parâmetro dinâmico do botão de URL (sufixo do link), se o template tiver. */
  buttonUrlParam?: string;
}

export interface WhatsappStatusUpdate {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error?: string;
}

export interface WhatsappProvider {
  name: string;
  sendTemplate(input: SendTemplateInput): Promise<{ providerMessageId: string }>;
  parseStatusWebhook(rawBody: string, headers: Headers): WhatsappStatusUpdate[];
}

export class WhatsappSendError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** Mensagens enviadas pelo mock ficam aqui (útil em testes e no log de dev). */
export const mockSent: SendTemplateInput[] = [];
let mockFailNext = 0;
export function mockWhatsappFailNext(n: number) {
  mockFailNext = n;
}

export const mockWhatsappProvider: WhatsappProvider = {
  name: "mock",
  async sendTemplate(input) {
    if (mockFailNext > 0) {
      mockFailNext--;
      throw new WhatsappSendError("falha simulada do provedor", true);
    }
    mockSent.push(input);
    if (process.env.NODE_ENV === "development") {
      console.info(`[whatsapp:mock] ${input.templateName} → ${input.toE164} ${JSON.stringify(input.bodyParams)}`);
    }
    return { providerMessageId: `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` };
  },
  parseStatusWebhook() {
    return [];
  },
};

export const metaWhatsappProvider: WhatsappProvider = {
  name: "meta",
  async sendTemplate(input) {
    if (!input.phoneNumberId || !input.accessToken) throw new WhatsappSendError("conexão sem credenciais", false);
    const components: unknown[] = [
      { type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) },
    ];
    if (input.buttonUrlParam) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: input.buttonUrlParam }],
      });
    }
    const res = await fetch(`https://graph.facebook.com/${env().WHATSAPP_GRAPH_VERSION}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.toE164.replace("+", ""),
        type: "template",
        template: { name: input.templateName, language: { code: input.language }, components },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new WhatsappSendError(`Meta ${res.status}: ${json.error?.message ?? "erro"}`, retryable);
    }
    const id = json.messages?.[0]?.id;
    if (!id) throw new WhatsappSendError("resposta sem id de mensagem", true);
    return { providerMessageId: id };
  },
  parseStatusWebhook(rawBody, headers) {
    const secret = env().WHATSAPP_APP_SECRET;
    const sig = (headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
    if (!secret || !sig || !safeEqual(sig, hmacSha256Hex(secret, rawBody))) throw new Error("assinatura inválida");
    type Status = { id: string; status: string; errors?: { title?: string }[] };
    const body = JSON.parse(rawBody) as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] };
    const out: WhatsappStatusUpdate[] = [];
    for (const e of body.entry ?? [])
      for (const c of e.changes ?? [])
        for (const s of c.value?.statuses ?? []) {
          if (["sent", "delivered", "read", "failed"].includes(s.status)) {
            out.push({ providerMessageId: s.id, status: s.status as WhatsappStatusUpdate["status"], error: s.errors?.[0]?.title });
          }
        }
    return out;
  },
};

export function whatsappProvider(name = env().WHATSAPP_PROVIDER): WhatsappProvider {
  return name === "meta" ? metaWhatsappProvider : mockWhatsappProvider;
}
