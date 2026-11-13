import type { MessageEvent } from "@prisma/client";
import { prisma, tenantDb } from "./db";
import { Errors } from "./errors";
import { audit } from "./audit";
import { isValidTime } from "./time";
import { whatsappProvider } from "./whatsapp/provider";
import { DEFAULT_TEMPLATES, OPT_OUT_FOOTER, definitionFor } from "./whatsapp/templates";

/**
 * Configuração das mensagens automáticas de uma empresa, num lugar só:
 * quais mensagens enviar, quando enviar e a janela de horário.
 */
export const MESSAGE_INFO: { event: MessageEvent; label: string; when: string }[] = [
  { event: "booking_confirmed", label: "Confirmação do agendamento", when: "Na hora em que o cliente agenda (ou paga o sinal)" },
  { event: "payment_pending", label: "Lembrete do Pix pendente", when: "Logo após a reserva, se houver sinal a pagar" },
  { event: "reminder", label: "Lembrete do horário", when: "Nas horas antes configuradas abaixo" },
  { event: "presence_request", label: "Pedido de confirmação de presença", when: "Nas horas antes configuradas abaixo (agendamentos sem sinal)" },
  { event: "rescheduled", label: "Aviso de remarcação", when: "Quando o horário muda" },
  { event: "cancelled", label: "Aviso de cancelamento", when: "Quando o agendamento é cancelado" },
  { event: "waitlist_offer", label: "Oferta da lista de espera", when: "Quando abre um horário no dia que o cliente queria" },
];

export interface MessageSettings {
  enabled: Record<MessageEvent, boolean>;
  reminderHours: number[];
  presenceRequestHours: number;
  presenceDeadlineHours: number;
  autoReleaseUnconfirmed: boolean;
  waitlistEnabled: boolean;
  sendWindowStart: string;
  sendWindowEnd: string;
}

export async function getMessageSettings(tenantId: string) {
  const db = tenantDb(tenantId);
  const [tenant, templates, conn] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    db.messageTemplate.findMany({}),
    db.whatsappConnection.findFirst({}),
  ]);
  const tpl = (e: MessageEvent) => templates.find((t) => t.eventType === e);
  return {
    events: MESSAGE_INFO.map((m) => ({
      ...m,
      enabled: tpl(m.event)?.enabled ?? true,
      templateName: tpl(m.event)?.providerTemplateId ?? definitionFor(m.event).name,
      status: tpl(m.event)?.status ?? null,
    })),
    reminderHours: tenant.reminderHours,
    presenceRequestHours: tenant.presenceRequestHours,
    presenceDeadlineHours: tenant.presenceDeadlineHours,
    autoReleaseUnconfirmed: tenant.autoReleaseUnconfirmed,
    waitlistEnabled: tenant.waitlistEnabled,
    sendWindowStart: conn?.sendWindowStart ?? "08:00",
    sendWindowEnd: conn?.sendWindowEnd ?? "21:00",
    connected: conn?.status === "connected",
    tenantName: tenant.name,
  };
}

export async function saveMessageSettings(tenantId: string, actorId: string, s: MessageSettings) {
  const reminders = [...new Set(s.reminderHours.filter((h) => Number.isInteger(h) && h >= 1 && h <= 168))].sort((a, b) => b - a).slice(0, 3);
  if (s.enabled.reminder && !reminders.length) throw Errors.validation("Informe ao menos um lembrete (ex.: 24 ou 2 horas antes)");
  if (s.presenceRequestHours < 1 || s.presenceRequestHours > 168) throw Errors.validation("Pedido de confirmação: entre 1 e 168 horas antes");
  if (s.presenceDeadlineHours < 0 || s.presenceDeadlineHours >= s.presenceRequestHours) {
    throw Errors.validation("O prazo para confirmar precisa ser menor que a antecedência do pedido de confirmação");
  }
  if (!isValidTime(s.sendWindowStart) || !isValidTime(s.sendWindowEnd) || s.sendWindowStart >= s.sendWindowEnd) {
    throw Errors.validation("Janela de envio inválida");
  }
  const db = tenantDb(tenantId);
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        reminderHours: reminders.length ? reminders : [2],
        presenceRequestHours: s.presenceRequestHours,
        presenceDeadlineHours: s.presenceDeadlineHours,
        autoReleaseUnconfirmed: s.autoReleaseUnconfirmed,
        waitlistEnabled: s.waitlistEnabled,
      },
    });
    for (const def of DEFAULT_TEMPLATES) {
      const enabled = s.enabled[def.event] ?? true;
      await tx.messageTemplate.upsert({
        where: { tenantId_eventType: { tenantId, eventType: def.event } },
        create: { tenantId, eventType: def.event, providerTemplateId: def.name, enabled },
        update: { enabled },
      });
      // Desligou: o que já estava na fila deste tipo não sai mais.
      if (!enabled) {
        await tx.messageOutbox.updateMany({ where: { tenantId, eventType: def.event, status: "pending" }, data: { status: "skipped", lastError: "desativada pela empresa" } });
      }
    }
  });
  const conn = await db.whatsappConnection.findFirst({});
  if (conn) await db.whatsappConnection.update({ where: { id: conn.id }, data: { sendWindowStart: s.sendWindowStart, sendWindowEnd: s.sendWindowEnd } });
  else
    await db.whatsappConnection.create({
      data: { tenantId, provider: whatsappProvider().name, status: "pending", sendWindowStart: s.sendWindowStart, sendWindowEnd: s.sendWindowEnd },
    });
  await audit({ tenantId, actorId, action: "messages.settings", resource: `tenant:${tenantId}`, meta: { enabled: s.enabled, reminders } });
}

/** Texto do template com valores de exemplo, para a prévia no painel. */
export function previewMessage(event: MessageEvent, sample: { customer: string; service: string; when: string; business: string }) {
  const def = definitionFor(event);
  const body = def.body.replace("{{1}}", sample.customer).replace("{{2}}", sample.service).replace("{{3}}", sample.when).replace("{{4}}", sample.business);
  return { body, footer: OPT_OUT_FOOTER, buttons: [...def.quickReplies, ...(def.url ? [def.url.text] : [])] };
}
