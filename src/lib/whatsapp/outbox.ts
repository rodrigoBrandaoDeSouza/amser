import type { Appointment, MessageEvent, Prisma, PrismaClient, Tenant } from "@prisma/client";
import { prisma } from "../db";
import { decryptJson } from "../crypto";
import { env } from "../env";
import { formatDateTime, wallParts, zonedToUtc, localDate, addDays } from "../time";
import { actionTokenExpiry, signActionToken } from "../tokens";
import { whatsappProvider, WhatsappSendError, type Credentials } from "./provider";
import { DEFAULT_TEMPLATES, definitionFor } from "./templates";
import type { WhatsappConnection } from "@prisma/client";

function credentialsOf(conn: WhatsappConnection | null): Credentials {
  const token = conn?.encryptedCredentials ? decryptJson<{ accessToken: string }>(conn.encryptedCredentials).accessToken : null;
  return { phoneNumberId: conn?.phoneNumberId ?? null, wabaId: conn?.wabaId ?? null, accessToken: token };
}

type Tx = Prisma.TransactionClient | PrismaClient;

export const MAX_ATTEMPTS = 5;

interface OutboxPayload {
  customerName: string;
  serviceName: string;
  tenantName: string;
  when: string;
  startsAt: string; // ISO — detecta reagendamento
  token: string;
}

function hasWhatsappConsent(consentJson: unknown): boolean {
  return !!(consentJson && typeof consentJson === "object" && (consentJson as Record<string, unknown>).whatsapp === true);
}

/**
 * Agenda as mensagens de um agendamento (§11). Só grava linhas no outbox —
 * o envio é assíncrono, então falha no WhatsApp nunca afeta o agendamento.
 * Idempotente: a chave inclui o horário, então reenfileirar não duplica.
 */
export async function scheduleAppointmentMessages(
  appointmentId: string,
  kind: "booked" | "payment_pending" | "rescheduled" | "cancelled",
  tx: Tx = prisma,
  now = new Date(),
) {
  const appt = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: true, service: true, tenant: true, unit: true },
  });
  if (!appt) return;
  if (!hasWhatsappConsent(appt.customer.consentJson)) return;

  const tz = appt.unit.timezone;
  const token = await signActionToken(appt.id, appt.tenantId, actionTokenExpiry(appt.startsAt));
  const payload: OutboxPayload = {
    customerName: appt.customer.name.split(" ")[0],
    serviceName: appt.service.name,
    tenantName: appt.tenant.name,
    when: formatDateTime(appt.startsAt, tz),
    startsAt: appt.startsAt.toISOString(),
    token,
  };
  const iso = appt.startsAt.toISOString();
  const rows: Prisma.MessageOutboxCreateManyInput[] = [];
  const push = (eventType: MessageEvent, scheduledAt: Date, suffix = "") =>
    rows.push({
      tenantId: appt.tenantId,
      appointmentId: appt.id,
      eventType,
      toPhoneE164: appt.customer.phoneE164,
      payloadJson: payload as unknown as Prisma.InputJsonValue,
      idempotencyKey: `${appt.id}:${eventType}:${iso}${suffix}`,
      scheduledAt,
    });

  if (kind === "payment_pending") {
    push("payment_pending", now);
  } else if (kind === "cancelled") {
    push("cancelled", now);
  } else {
    push(kind === "rescheduled" ? "rescheduled" : "booking_confirmed", now);
    for (const h of appt.tenant.reminderHours) {
      const at = new Date(appt.startsAt.getTime() - h * 3600_000);
      if (at > now) push("reminder", at, `:${h}h`);
    }
    if (appt.status === "pendente" && !appt.confirmedPresenceAt) {
      const at = new Date(appt.startsAt.getTime() - appt.tenant.presenceRequestHours * 3600_000);
      // Se já passou do momento ideal, pede agora (desde que falte mais de 1h).
      if (at > now) push("presence_request", at);
      else if (appt.startsAt.getTime() - now.getTime() > 3600_000) push("presence_request", now);
    }
  }
  if (rows.length) await tx.messageOutbox.createMany({ data: rows, skipDuplicates: true });
}

/** Versão que nunca lança — usada após o commit do agendamento. */
export async function scheduleAppointmentMessagesSafe(...args: Parameters<typeof scheduleAppointmentMessages>) {
  try {
    await scheduleAppointmentMessages(...args);
    kickOutbox();
  } catch (err) {
    console.error("[outbox] falha ao enfileirar mensagens", err instanceof Error ? err.message : err);
  }
}

/**
 * Dispara o envio logo após enfileirar (confirmação chega em segundos, sem
 * esperar o próximo ciclo do worker). Não bloqueia a resposta; o "claim" do
 * outbox impede envio duplicado se o worker processar ao mesmo tempo.
 */
let kickRunning = false;
let kickAgain = false;
export function kickOutbox() {
  if (process.env.NODE_ENV === "test" || process.env.OUTBOX_KICK === "false") return;
  if (kickRunning) {
    kickAgain = true;
    return;
  }
  kickRunning = true;
  void (async () => {
    try {
      do {
        kickAgain = false;
        await processOutbox(new Date(), 20);
      } while (kickAgain);
    } catch (err) {
      console.error("[outbox] envio imediato falhou (o worker tenta de novo)", err instanceof Error ? err.message : err);
    } finally {
      kickRunning = false;
    }
  })();
}

function inSendWindow(now: Date, tz: string, start: string, end: string): boolean {
  const p = wallParts(now, tz);
  const hm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return hm >= start && hm < end;
}

function nextWindowStart(now: Date, tz: string, start: string): Date {
  const today = localDate(now, tz);
  const candidate = zonedToUtc(today, start, tz);
  return candidate > now ? candidate : zonedToUtc(addDays(today, 1), start, tz);
}

const IMMEDIATE_EVENTS: MessageEvent[] = ["booking_confirmed", "payment_pending", "rescheduled", "cancelled"];
const ACTIVE = ["aguardando_sinal", "pendente", "confirmado"];

function period(now: Date) {
  return now.toISOString().slice(0, 7);
}

/**
 * Processa o outbox: envia mensagens vencidas com retentativas e backoff
 * exponencial; após MAX_ATTEMPTS vai para "dead" (dead-letter).
 */
export async function processOutbox(now = new Date(), limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, skipped: 0 };
  const due = await prisma.messageOutbox.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });
  const provider = whatsappProvider();

  for (const msg of due) {
    // "Claim" otimista: só um worker processa cada linha.
    const claimed = await prisma.messageOutbox.updateMany({
      where: { id: msg.id, status: "pending", attempts: msg.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const attempt = msg.attempts + 1;
    const skip = async (reason: string) => {
      stats.skipped++;
      await prisma.messageOutbox.update({ where: { id: msg.id }, data: { status: "skipped", lastError: reason } });
    };

    try {
      const payload = msg.payloadJson as unknown as OutboxPayload;
      let appt: (Appointment & { tenant: Tenant; unit: { timezone: string } }) | null = null;
      if (msg.appointmentId) {
        appt = await prisma.appointment.findUnique({ where: { id: msg.appointmentId }, include: { tenant: true, unit: true } });
        if (!appt) {
          await skip("agendamento removido");
          continue;
        }
        if (msg.eventType !== "cancelled") {
          if (appt.startsAt.toISOString() !== payload.startsAt) {
            await skip("agendamento remarcado");
            continue;
          }
          if (!ACTIVE.includes(appt.status)) {
            await skip(`status ${appt.status}`);
            continue;
          }
          if (msg.eventType === "presence_request" && appt.confirmedPresenceAt) {
            await skip("presença já confirmada");
            continue;
          }
        }
      }

      const conn = await prisma.whatsappConnection.findUnique({ where: { tenantId: msg.tenantId } });
      if (provider.name !== "mock" && (!conn || conn.status !== "connected")) {
        await skip("WhatsApp não conectado");
        continue;
      }

      const tz = appt?.unit.timezone ?? "America/Sao_Paulo";
      const winStart = conn?.sendWindowStart ?? "08:00";
      const winEnd = conn?.sendWindowEnd ?? "21:00";
      if (!IMMEDIATE_EVENTS.includes(msg.eventType) && !inSendWindow(now, tz, winStart, winEnd)) {
        const next = nextWindowStart(now, tz, winStart);
        if (appt && next >= appt.startsAt) {
          await skip("fora da janela de envio");
        } else {
          await prisma.messageOutbox.update({ where: { id: msg.id }, data: { scheduledAt: next, attempts: msg.attempts } });
        }
        continue;
      }

      // Consentimento verificado também no momento do envio (o cliente pode ter saído).
      const customer = await prisma.customer.findFirst({ where: { tenantId: msg.tenantId, phoneE164: msg.toPhoneE164 } });
      if (customer && (customer.optedOutAt || (customer.consentJson as Record<string, unknown>)?.whatsapp !== true)) {
        await skip("cliente sem consentimento");
        continue;
      }

      const template = await prisma.messageTemplate.findUnique({
        where: { tenantId_eventType: { tenantId: msg.tenantId, eventType: msg.eventType } },
      });
      if (template && !template.enabled) {
        await skip("template desativado");
        continue;
      }
      if (provider.name !== "mock") {
        if (!template) {
          await skip("template não configurado");
          continue;
        }
        if (template.status === "PENDING" || template.status === "UNKNOWN" || template.status === "IN_APPEAL") {
          // Ainda em análise na Meta: tenta de novo em 30 min, se ainda fizer sentido.
          const retryAt = new Date(now.getTime() + 30 * 60_000);
          if (appt && retryAt >= appt.startsAt) await skip("template ainda não aprovado");
          else await prisma.messageOutbox.update({ where: { id: msg.id }, data: { scheduledAt: retryAt, attempts: msg.attempts, lastError: "template em análise na Meta" } });
          continue;
        }
        if (template.status !== "APPROVED") {
          await skip(`template ${template.status}`);
          continue;
        }
      }

      const templateName = template?.providerTemplateId ?? definitionFor(msg.eventType).name;
      // Botão URL só quando o template padrão tem (o de presença usa só respostas rápidas).
      const known = DEFAULT_TEMPLATES.find((d) => d.name === templateName);
      const hasUrlButton = known ? !!known.url : true;
      const { providerMessageId } = await provider.sendTemplate({
        ...credentialsOf(conn),
        toE164: msg.toPhoneE164,
        templateName,
        language: template?.language ?? "pt_BR",
        bodyParams: [payload.customerName, payload.serviceName, payload.when, payload.tenantName],
        buttonUrlParam: hasUrlButton ? payload.token : undefined,
      });

      await prisma.$transaction([
        prisma.messageOutbox.update({
          where: { id: msg.id },
          data: { status: "sent", providerMessageId, sentAt: now, lastError: null },
        }),
        // Franquia: contabiliza; nunca bloqueia (o painel avisa ao se aproximar do limite).
        prisma.messageUsage.upsert({
          where: { tenantId_period: { tenantId: msg.tenantId, period: period(now) } },
          create: { tenantId: msg.tenantId, period: period(now), messagesSent: 1, quota: await quotaFor(msg.tenantId) },
          update: { messagesSent: { increment: 1 } },
        }),
      ]);
      stats.sent++;
    } catch (err) {
      stats.failed++;
      const retryable = !(err instanceof WhatsappSendError) || err.retryable;
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const dead = !retryable || attempt >= MAX_ATTEMPTS;
      if (err instanceof WhatsappSendError && err.kind === "opt_out") {
        // 131050/130403: o cliente bloqueou ou saiu — respeitar e parar de enviar.
        const { optOutCustomer } = await import("./service");
        await optOutCustomer(msg.tenantId, msg.toPhoneE164, `meta:${err.code}`);
      }
      if (err instanceof WhatsappSendError && err.kind === "auth") {
        await prisma.whatsappConnection.updateMany({ where: { tenantId: msg.tenantId }, data: { status: "error", lastError: message } });
      }
      await prisma.messageOutbox.update({
        where: { id: msg.id },
        data: dead
          ? { status: "dead", lastError: message }
          : { lastError: message, scheduledAt: new Date(now.getTime() + 2 ** attempt * 60_000) },
      });
    }
  }
  return stats;
}

async function quotaFor(tenantId: string): Promise<number> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  return t?.plan?.messageQuota ?? 300;
}

export function appUrl(path: string) {
  return `${env().APP_URL.replace(/\/$/, "")}${path}`;
}
