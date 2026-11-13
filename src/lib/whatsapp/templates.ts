import type { MessageEvent } from "@prisma/client";
import { env } from "../env";

/**
 * Templates padrão do Amser (categoria UTILITY, pt_BR, parâmetros posicionais).
 * Corpo: {{1}} nome do cliente · {{2}} serviço · {{3}} data/hora · {{4}} negócio.
 * Regras conferidas na doc da Meta (2026-11-13):
 *  - nome ^[a-z0-9_]+$; variável não pode abrir nem fechar o corpo;
 *  - botão URL: 1 variável no FIM da URL; example = só o valor da variável;
 *  - quick replies agrupados; rodapé ≤ 60 caracteres.
 * O índice do botão URL em templates que também têm quick replies NÃO está
 * documentado; por isso o template de presença usa só quick replies (sem URL).
 */
export interface TemplateDefinition {
  event: MessageEvent;
  name: string;
  body: string;
  quickReplies: string[];
  url: { text: string; path: "/a/" | "/w/" } | null;
}

export const OPT_OUT_FOOTER = "Responda SAIR para não receber mais mensagens.";
export const QR_CONFIRM = "Confirmo presença";
export const QR_RESCHEDULE = "Preciso remarcar";

export const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    event: "booking_confirmed",
    name: "amser_agendamento_confirmado",
    body: "Olá, {{1}}! Seu horário de {{2}} em {{4}} está confirmado para {{3}}. Para ver, remarcar ou cancelar, use o botão abaixo.",
    quickReplies: [],
    url: { text: "Ver agendamento", path: "/a/" },
  },
  {
    event: "payment_pending",
    name: "amser_sinal_pendente",
    body: "Olá, {{1}}! Seu horário de {{2}} em {{4}} ({{3}}) está reservado. Pague o sinal via Pix pelo botão abaixo para confirmar.",
    quickReplies: [],
    url: { text: "Pagar sinal", path: "/a/" },
  },
  {
    event: "reminder",
    name: "amser_lembrete",
    body: "Lembrete: {{1}}, seu horário de {{2}} em {{4}} é {{3}}. Até lá!",
    quickReplies: [],
    url: { text: "Ver agendamento", path: "/a/" },
  },
  {
    event: "presence_request",
    name: "amser_confirmar_presenca",
    body: "Oi, {{1}}! Você confirma seu horário de {{2}} em {{4}}, {{3}}? Toque em uma opção abaixo.",
    quickReplies: [QR_CONFIRM, QR_RESCHEDULE],
    url: null,
  },
  {
    event: "rescheduled",
    name: "amser_remarcado",
    body: "Olá, {{1}}! Seu horário de {{2}} em {{4}} foi alterado para {{3}}. Os detalhes estão no botão abaixo.",
    quickReplies: [],
    url: { text: "Ver agendamento", path: "/a/" },
  },
  {
    event: "cancelled",
    name: "amser_cancelado",
    body: "Olá, {{1}}. Seu horário de {{2}} em {{4}} ({{3}}) foi cancelado. Para agendar de novo, use o botão abaixo.",
    quickReplies: [],
    url: { text: "Ver detalhes", path: "/a/" },
  },
  {
    event: "waitlist_offer",
    name: "amser_lista_de_espera",
    body: "Boa notícia, {{1}}! Abriu um horário de {{2}} em {{4}}: {{3}}. Quem reservar primeiro garante a vaga.",
    quickReplies: [],
    url: { text: "Reservar agora", path: "/w/" },
  },
];

export function definitionFor(event: MessageEvent): TemplateDefinition {
  const d = DEFAULT_TEMPLATES.find((t) => t.event === event);
  if (!d) throw new Error(`sem template padrão para ${event}`);
  return d;
}

/** Corpo do POST /{WABA-ID}/message_templates. */
export function templateCreatePayload(def: TemplateDefinition) {
  const base = env().APP_URL.replace(/\/$/, "");
  const buttons = [
    ...def.quickReplies.map((text) => ({ type: "QUICK_REPLY", text })),
    ...(def.url ? [{ type: "URL", text: def.url.text, url: `${base}${def.url.path}{{1}}`, example: ["exemplo123"] }] : []),
  ];
  return {
    name: def.name,
    language: "pt_BR",
    category: "UTILITY",
    components: [
      { type: "BODY", text: def.body, example: { body_text: [["Ana", "Design de sobrancelha", "sex., 15/11, 14:00", "Studio Bela"]] } },
      { type: "FOOTER", text: OPT_OUT_FOOTER },
      ...(buttons.length ? [{ type: "BUTTONS", buttons }] : []),
    ],
  };
}

/** Palavras que o cliente pode mandar para sair (opt-out). */
const OPT_OUT_WORDS = ["sair", "parar", "pare", "stop", "descadastrar", "cancelar mensagens", "nao quero mais"];
const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");

export function isOptOutText(text: string): boolean {
  return OPT_OUT_WORDS.includes(norm(text));
}

export function isQuickReply(text: string, label: string): boolean {
  return norm(text) === norm(label);
}
