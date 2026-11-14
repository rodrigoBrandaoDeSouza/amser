import { env } from "../env";
import { hmacSha256Hex, safeEqual } from "../crypto";

/**
 * WhatsApp Business Platform — Cloud API oficial (Meta). Conferido na
 * documentação em 2026-11-13 (Graph API v27.0):
 *  - envio:       POST /{phone-number-id}/messages
 *  - número:      GET  /{phone-number-id}?fields=…
 *  - templates:   GET/POST /{waba-id}/message_templates
 *  - assinatura:  POST /{waba-id}/subscribed_apps (endpoint listado na doc; corpo não detalhado)
 *
 * Cadastro integrado (Embedded Signup v5) e coexistência — conferido em 2026-11-14 (ADR 0015):
 *  - troca do código: GET /oauth/access_token?client_id&client_secret&code → token de negócio
 *  - registro:        POST /{phone-number-id}/register {messaging_product, pin} (NÃO usar na coexistência)
 *  - sincronização:   POST /{phone-number-id}/smb_app_data {messaging_product, sync_type}
 *                     sync_type "smb_app_state_sync" (contatos) e "history"; uma vez cada, até 24h
 *  - desconexão:      field "account_update" com event "PARTNER_REMOVED" (o dono desligou no app)
 *  - webhook:     X-Hub-Signature-256 = HMAC-SHA256(corpo, app secret); roteamento por
 *                 value.metadata.phone_number_id; status em value.statuses[]; mensagens em
 *                 value.messages[] (text / button / interactive); templates em
 *                 field "message_template_status_update".
 */

export interface Credentials {
  phoneNumberId: string | null;
  wabaId: string | null;
  accessToken: string | null;
}

export interface SendTemplateInput extends Credentials {
  toE164: string;
  templateName: string;
  language: string;
  bodyParams: string[];
  /** Sufixo dinâmico do botão URL (índice 0), se o template tiver. */
  buttonUrlParam?: string;
}

export interface PhoneInfo {
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string | null;
  status: string | null;
}

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
}

export type WebhookEvent =
  | { kind: "status"; phoneNumberId: string | null; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; errorCode?: number; error?: string }
  | {
      kind: "message";
      phoneNumberId: string;
      messageId: string;
      fromPhone: string | null;
      fromUserId: string | null;
      profileName: string | null;
      type: "text" | "button" | "interactive" | "other";
      text: string;
      contextMessageId: string | null;
    }
  | { kind: "template_status"; wabaId: string; templateId: string; name: string; language: string; status: string; reason: string | null }
  | { kind: "partner_removed"; wabaId: string };

export type SmbSyncType = "smb_app_state_sync" | "history";

export interface WhatsappProvider {
  name: string;
  sendTemplate(input: SendTemplateInput): Promise<{ providerMessageId: string }>;
  /** Texto livre — só dentro da janela de 24h aberta pelo cliente. */
  sendText(input: Credentials & { toE164: string; text: string }): Promise<{ providerMessageId: string }>;
  phoneInfo(c: Credentials): Promise<PhoneInfo>;
  subscribeApp(c: Credentials): Promise<void>;
  listTemplates(c: Credentials): Promise<RemoteTemplate[]>;
  createTemplate(c: Credentials, payload: object): Promise<{ id: string; status: string }>;
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent[];
  /** Cadastro integrado: troca o código (vale 30 s) por um token de negócio. Só no servidor. */
  exchangeCode(code: string): Promise<string>;
  /** Registra o número na Cloud API (número novo; NÃO usar na coexistência). */
  registerNumber(c: Credentials, pin: string): Promise<void>;
  /** Coexistência: pede à Meta a sincronização do app WhatsApp Business. */
  syncSmbAppData(c: Credentials, syncType: SmbSyncType): Promise<void>;
}

/** Erro da Meta classificado: retentável ou não, e se indica opt-out/bloqueio ou token inválido. */
export class WhatsappSendError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public code?: number,
    public kind: "generic" | "opt_out" | "auth" | "template" = "generic",
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131056, 131057, 2494100]);
const OPT_OUT = new Set([131050, 130403]);
const AUTH = new Set([0, 190]);
const TEMPLATE = new Set([132000, 132001, 132007, 132012, 132015, 132016]);

export function classifyMetaError(code: number | undefined, message: string, httpStatus?: number): WhatsappSendError {
  if (code !== undefined) {
    if (RETRYABLE.has(code)) return new WhatsappSendError(message, true, code);
    if (OPT_OUT.has(code)) return new WhatsappSendError(message, false, code, "opt_out");
    if (AUTH.has(code)) return new WhatsappSendError(message, false, code, "auth");
    if (TEMPLATE.has(code)) return new WhatsappSendError(message, false, code, "template");
    return new WhatsappSendError(message, false, code);
  }
  return new WhatsappSendError(message, httpStatus === undefined || httpStatus === 429 || httpStatus >= 500);
}

// ---------------------------------------------------------------------------
// Meta (produção)
// ---------------------------------------------------------------------------
const graph = (path: string) => `https://graph.facebook.com/${env().WHATSAPP_GRAPH_VERSION}/${path}`;

async function call(c: Credentials, path: string, init: RequestInit = {}) {
  if (!c.accessToken) throw new WhatsappSendError("conexão sem token", false, undefined, "auth");
  let res: Response;
  try {
    res = await fetch(graph(path), {
      ...init,
      headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new WhatsappSendError(`rede: ${err instanceof Error ? err.message : err}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: number; message?: string } };
  if (!res.ok) throw classifyMetaError(json.error?.code, `Meta ${res.status}: ${json.error?.message ?? "erro"} (#${json.error?.code ?? "?"})`, res.status);
  return json;
}

export const metaWhatsappProvider: WhatsappProvider = {
  name: "meta",
  async sendTemplate(input) {
    if (!input.phoneNumberId) throw new WhatsappSendError("conexão sem phone_number_id", false, undefined, "auth");
    const components: unknown[] = input.bodyParams.length ? [{ type: "body", parameters: input.bodyParams.map((text) => ({ type: "text", text })) }] : [];
    if (input.buttonUrlParam) {
      components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: encodeURIComponent(input.buttonUrlParam) }] });
    }
    const json = await call(input, `${input.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.toE164,
        type: "template",
        template: { name: input.templateName, language: { code: input.language }, components },
      }),
    });
    const id = (json.messages as { id: string }[] | undefined)?.[0]?.id;
    if (!id) throw new WhatsappSendError("resposta sem id de mensagem", true);
    return { providerMessageId: id };
  },
  async sendText(input) {
    const json = await call(input, `${input.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.toE164, type: "text", text: { body: input.text } }),
    });
    return { providerMessageId: (json.messages as { id: string }[] | undefined)?.[0]?.id ?? "" };
  },
  async phoneInfo(c) {
    if (!c.phoneNumberId) throw new WhatsappSendError("informe o Phone Number ID", false);
    const j = await call(c, `${c.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,status`);
    return {
      displayPhoneNumber: String(j.display_phone_number ?? ""),
      verifiedName: String(j.verified_name ?? ""),
      qualityRating: (j.quality_rating as string) ?? null,
      status: (j.status as string) ?? null,
    };
  },
  async subscribeApp(c) {
    if (!c.wabaId) throw new WhatsappSendError("informe o WABA ID", false);
    await call(c, `${c.wabaId}/subscribed_apps`, { method: "POST" });
  },
  async listTemplates(c) {
    if (!c.wabaId) throw new WhatsappSendError("informe o WABA ID", false);
    const out: RemoteTemplate[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ fields: "id,name,language,status,category,rejected_reason", limit: "100", ...(after ? { after } : {}) });
      const j = await call(c, `${c.wabaId}/message_templates?${q}`);
      for (const t of (j.data as Record<string, unknown>[]) ?? []) {
        out.push({
          id: String(t.id),
          name: String(t.name),
          language: String(t.language),
          status: String(t.status),
          category: (t.category as string) ?? null,
          rejectedReason: (t.rejected_reason as string) ?? null,
        });
      }
      const paging = j.paging as { next?: string; cursors?: { after?: string } } | undefined;
      if (!paging?.next) break;
      after = paging.cursors?.after ?? null;
      if (!after) break;
    }
    return out;
  },
  async createTemplate(c, payload) {
    if (!c.wabaId) throw new WhatsappSendError("informe o WABA ID", false);
    const j = await call(c, `${c.wabaId}/message_templates`, { method: "POST", body: JSON.stringify(payload) });
    return { id: String(j.id ?? ""), status: String(j.status ?? "PENDING") };
  },
  async exchangeCode(code) {
    const e = env();
    if (!e.WHATSAPP_APP_ID || !e.WHATSAPP_APP_SECRET) throw new WhatsappSendError("cadastro integrado não configurado (WHATSAPP_APP_ID/WHATSAPP_APP_SECRET)", false);
    const q = new URLSearchParams({ client_id: e.WHATSAPP_APP_ID, client_secret: e.WHATSAPP_APP_SECRET, code });
    let res: Response;
    try {
      res = await fetch(graph(`oauth/access_token?${q}`), { signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new WhatsappSendError(`rede: ${err instanceof Error ? err.message : err}`, true);
    }
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { code?: number; message?: string } };
    if (!res.ok || !j.access_token) throw classifyMetaError(j.error?.code, `Meta ${res.status}: ${j.error?.message ?? "código inválido ou expirado"}`, res.status);
    return j.access_token;
  },
  async registerNumber(c, pin) {
    await call(c, `${c.phoneNumberId}/register`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
  },
  async syncSmbAppData(c, syncType) {
    await call(c, `${c.phoneNumberId}/smb_app_data`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }) });
  },
  parseWebhook(rawBody, headers) {
    const secret = env().WHATSAPP_APP_SECRET;
    const sig = (headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
    if (!secret || !sig || !safeEqual(sig, hmacSha256Hex(secret, rawBody))) throw new Error("assinatura inválida");
    return parseMetaPayload(JSON.parse(rawBody));
  },
};

type Json = Record<string, unknown>;

/** Converte o payload do webhook da Meta em eventos tipados (sem efeitos colaterais). */
export function parseMetaPayload(body: Json): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  for (const entry of (body.entry as Json[]) ?? []) {
    for (const change of (entry.changes as Json[]) ?? []) {
      const value = (change.value ?? {}) as Json;
      if (change.field === "message_template_status_update") {
        out.push({
          kind: "template_status",
          wabaId: String(entry.id),
          templateId: String(value.message_template_id ?? ""),
          name: String(value.message_template_name ?? ""),
          language: String(value.message_template_language ?? "").replace("-", "_"),
          status: String(value.event ?? ""),
          reason: (value.reason as string) ?? null,
        });
        continue;
      }
      if (change.field === "account_update") {
        // O dono desconectou o Amser pelo app WhatsApp Business (coexistência).
        if (value.event === "PARTNER_REMOVED") out.push({ kind: "partner_removed", wabaId: String(entry.id) });
        continue;
      }
      // Coexistência: "smb_message_echoes" (o que o dono escreveu pelo celular), "history" e
      // "smb_app_state_sync" (conversas e contatos do app) são IGNORADOS de propósito — o Amser
      // não guarda as conversas do negócio (minimização de dados, LGPD; ADR 0015).
      if (change.field !== "messages") continue;
      const phoneNumberId = ((value.metadata as Json)?.phone_number_id as string) ?? null;
      for (const s of (value.statuses as Json[]) ?? []) {
        const st = String(s.status);
        if (!["sent", "delivered", "read", "failed"].includes(st)) continue;
        const err = ((s.errors as Json[]) ?? [])[0];
        out.push({
          kind: "status",
          phoneNumberId,
          providerMessageId: String(s.id),
          status: st as "sent",
          errorCode: err ? Number(err.code) : undefined,
          error: err ? `${err.code}: ${err.title ?? err.message ?? ""}` : undefined,
        });
      }
      const contacts = (value.contacts as Json[]) ?? [];
      for (const m of (value.messages as Json[]) ?? []) {
        if (!phoneNumberId) continue;
        const contact = contacts.find((c) => c.wa_id === m.from || c.user_id === m.from_user_id) ?? contacts[0];
        const type = String(m.type);
        let text = "";
        if (type === "text") text = String((m.text as Json)?.body ?? "");
        else if (type === "button") text = String((m.button as Json)?.text ?? (m.button as Json)?.payload ?? "");
        else if (type === "interactive") {
          const i = m.interactive as Json;
          text = String(((i?.button_reply ?? i?.list_reply) as Json)?.title ?? "");
        }
        out.push({
          kind: "message",
          phoneNumberId,
          messageId: String(m.id),
          fromPhone: m.from ? `+${String(m.from).replace(/^\+/, "")}` : null,
          fromUserId: (m.from_user_id as string) ?? ((contact?.user_id as string) ?? null),
          profileName: ((contact?.profile as Json)?.name as string) ?? null,
          type: type === "text" || type === "button" || type === "interactive" ? type : "other",
          text,
          contextMessageId: ((m.context as Json)?.id as string) ?? null,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mock (dev/testes)
// ---------------------------------------------------------------------------
export const mockSent: (SendTemplateInput | (Credentials & { toE164: string; text: string }))[] = [];
/** Chamadas de onboarding feitas ao mock (testes). */
export const mockOnboardingCalls: string[] = [];
let mockFailures: { n: number; code?: number } = { n: 0 };
export function mockWhatsappFailNext(n: number, code?: number) {
  mockFailures = { n, code };
}

export const mockWhatsappProvider: WhatsappProvider = {
  name: "mock",
  async sendTemplate(input) {
    if (mockFailures.n > 0) {
      mockFailures.n--;
      throw mockFailures.code !== undefined ? classifyMetaError(mockFailures.code, `falha simulada #${mockFailures.code}`) : new WhatsappSendError("falha simulada do provedor", true);
    }
    mockSent.push(input);
    if (process.env.NODE_ENV === "development") console.info(`[whatsapp:mock] ${input.templateName} → ${input.toE164} ${JSON.stringify(input.bodyParams)}`);
    return { providerMessageId: `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}` };
  },
  async sendText(input) {
    mockSent.push(input);
    if (process.env.NODE_ENV === "development") console.info(`[whatsapp:mock] texto → ${input.toE164}: ${input.text}`);
    return { providerMessageId: `wamid.mock.text.${Date.now()}` };
  },
  async phoneInfo(c) {
    if (!c.phoneNumberId) throw new WhatsappSendError("informe o Phone Number ID", false);
    return { displayPhoneNumber: "+55 11 90000-0000", verifiedName: "Negócio de teste", qualityRating: "GREEN", status: "CONNECTED" };
  },
  async subscribeApp() {},
  async listTemplates() {
    return [];
  },
  async createTemplate(_c, payload) {
    return { id: `mock_tpl_${(payload as { name: string }).name}`, status: "APPROVED" };
  },
  parseWebhook(rawBody) {
    return parseMetaPayload(JSON.parse(rawBody));
  },
  async exchangeCode(code) {
    if (code === "codigo-expirado") throw new WhatsappSendError("Meta 400: código inválido ou expirado (#100)", false, 100);
    mockOnboardingCalls.push(`exchange:${code}`);
    return `mock-business-token-${code}`;
  },
  async registerNumber(c, pin) {
    mockOnboardingCalls.push(`register:${c.phoneNumberId}:${pin.length}`);
  },
  async syncSmbAppData(c, syncType) {
    mockOnboardingCalls.push(`sync:${c.phoneNumberId}:${syncType}`);
  },
};

export function whatsappProvider(name = env().WHATSAPP_PROVIDER): WhatsappProvider {
  return name === "meta" ? metaWhatsappProvider : mockWhatsappProvider;
}
