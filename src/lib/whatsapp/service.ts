import type { WhatsappConnection } from "@prisma/client";
import { prisma, tenantDb } from "../db";
import { decryptJson, encryptJson } from "../crypto";
import { audit } from "../audit";
import { Errors, AppError } from "../errors";
import { actionTokenExpiry, signActionToken } from "../tokens";
import { confirmPresence } from "../scheduling/booking";
import { DEFAULT_TEMPLATES, QR_CONFIRM, QR_RESCHEDULE, isOptOutText, isQuickReply, templateCreatePayload } from "./templates";
import { whatsappProvider, WhatsappSendError, type Credentials, type WebhookEvent } from "./provider";
import { env } from "../env";

export function credentialsOf(conn: WhatsappConnection | null): Credentials {
  const token = conn?.encryptedCredentials ? decryptJson<{ accessToken: string }>(conn.encryptedCredentials).accessToken : null;
  return { phoneNumberId: conn?.phoneNumberId ?? null, wabaId: conn?.wabaId ?? null, accessToken: token };
}

/**
 * Salva a conexão e TESTA na Meta: lê o número (nome verificado, qualidade,
 * status) e inscreve o app na WABA para receber webhooks.
 */
export async function saveAndTestConnection(
  tenantId: string,
  actorId: string,
  input: { phoneNumberId: string; wabaId: string; accessToken?: string | null; sendWindowStart: string; sendWindowEnd: string },
) {
  const db = tenantDb(tenantId);
  const existing = await db.whatsappConnection.findFirst({});
  const provider = whatsappProvider();
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) throw Errors.validation("Phone Number ID inválido (só números)");
  if (!/^\d{5,30}$/.test(input.wabaId)) throw Errors.validation("WABA ID inválido (só números)");
  const other = await prisma.whatsappConnection.findFirst({ where: { phoneNumberId: input.phoneNumberId, tenantId: { not: tenantId } } });
  if (other) throw Errors.validation("Este número já está conectado a outra empresa");

  const encrypted = input.accessToken ? encryptJson({ accessToken: input.accessToken }) : existing?.encryptedCredentials;
  if (!encrypted) throw Errors.validation("Informe o token de acesso");
  const creds: Credentials = { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, accessToken: decryptJson<{ accessToken: string }>(encrypted).accessToken };

  let status: "connected" | "error" = "connected";
  let lastError: string | null = null;
  let info = null;
  try {
    info = await provider.phoneInfo(creds);
    if (info.status && info.status.toUpperCase() !== "CONNECTED") {
      status = "error";
      lastError = `Número com status ${info.status} na Meta`;
    }
  } catch (err) {
    status = "error";
    lastError = err instanceof Error ? err.message : String(err);
  }
  let subscribeWarning: string | null = null;
  if (status === "connected") {
    try {
      await provider.subscribeApp(creds);
    } catch (err) {
      subscribeWarning = err instanceof Error ? err.message : String(err);
    }
  }
  const data = {
    provider: provider.name,
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    encryptedCredentials: encrypted,
    displayPhone: info?.displayPhoneNumber ?? existing?.displayPhone ?? null,
    verifiedName: info?.verifiedName ?? null,
    qualityRating: info?.qualityRating ?? null,
    sendWindowStart: input.sendWindowStart,
    sendWindowEnd: input.sendWindowEnd,
    status,
    lastError,
    lastCheckedAt: new Date(),
  };
  if (existing) await db.whatsappConnection.update({ where: { id: existing.id }, data });
  else await db.whatsappConnection.create({ data: { ...data, tenantId } });
  await audit({ tenantId, actorId, action: "whatsapp.connect", resource: `tenant:${tenantId}`, meta: { status } });
  if (status === "error") throw new AppError("whatsapp_error", `Não foi possível validar na Meta: ${lastError}`, 422);
  return { info, subscribeWarning };
}

async function connectionOrThrow(tenantId: string) {
  const conn = await tenantDb(tenantId).whatsappConnection.findFirst({});
  if (!conn || conn.status !== "connected") throw Errors.policy("Conecte e valide o WhatsApp primeiro");
  return conn;
}

/** Cria na Meta os templates padrão que ainda não existem (ficam em análise). */
export async function provisionTemplates(tenantId: string, actorId: string) {
  const conn = await connectionOrThrow(tenantId);
  const creds = credentialsOf(conn);
  const provider = whatsappProvider();
  const remote = await provider.listTemplates(creds);
  const db = tenantDb(tenantId);
  const results: { name: string; status: string; error?: string }[] = [];
  for (const def of DEFAULT_TEMPLATES) {
    const found = remote.find((t) => t.name === def.name && t.language === "pt_BR");
    let status = found?.status ?? "PENDING";
    let metaId = found?.id ?? null;
    let error: string | undefined;
    if (!found) {
      try {
        const r = await provider.createTemplate(creds, templateCreatePayload(def));
        status = r.status;
        metaId = r.id;
      } catch (err) {
        status = "ERROR";
        error = err instanceof Error ? err.message : String(err);
      }
    }
    await db.messageTemplate.upsert({
      where: { tenantId_eventType: { tenantId, eventType: def.event } },
      create: { tenantId, eventType: def.event, providerTemplateId: def.name, status, metaTemplateId: metaId, category: "UTILITY", lastSyncedAt: new Date() },
      update: { providerTemplateId: def.name, status, metaTemplateId: metaId, lastSyncedAt: new Date() },
    });
    results.push({ name: def.name, status, error });
  }
  await audit({ tenantId, actorId, action: "whatsapp.templates.provision", resource: `tenant:${tenantId}` });
  return results;
}

/** Atualiza o status (APPROVED/PENDING/REJECTED…) dos templates configurados. */
export async function syncTemplates(tenantId: string) {
  const conn = await connectionOrThrow(tenantId);
  const remote = await whatsappProvider().listTemplates(credentialsOf(conn));
  const db = tenantDb(tenantId);
  const local = await db.messageTemplate.findMany({});
  for (const t of local) {
    const r = remote.find((x) => x.name === t.providerTemplateId && x.language === t.language);
    await db.messageTemplate.update({
      where: { id: t.id },
      data: r
        ? { status: r.status, category: r.category, rejectedReason: r.rejectedReason, metaTemplateId: r.id, lastSyncedAt: new Date() }
        : { status: whatsappProvider().name === "mock" ? t.status : "NOT_FOUND", lastSyncedAt: new Date() },
    });
  }
  return local.length;
}

/** Revogação de consentimento (LGPD / política da Meta). */
export async function optOutCustomer(tenantId: string, phoneE164: string, source: string) {
  const db = tenantDb(tenantId);
  const c = await db.customer.findFirst({ where: { phoneE164 } });
  if (!c) return false;
  const consent = { ...((c.consentJson as Record<string, unknown>) ?? {}), whatsapp: false, whatsappOptOutAt: new Date().toISOString(), optOutSource: source };
  await db.customer.update({ where: { id: c.id }, data: { consentJson: consent, optedOutAt: new Date() } });
  await db.messageOutbox.updateMany({ where: { toPhoneE164: phoneE164, status: "pending" }, data: { status: "skipped", lastError: "cliente pediu para sair" } });
  await audit({ tenantId, action: "customer.opt_out", resource: `customer:${c.id}`, meta: { source } });
  return true;
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/** Processa o webhook da Meta (já com assinatura verificada). Idempotente. */
export async function handleWhatsappEvents(events: WebhookEvent[]) {
  const stats = { statuses: 0, messages: 0, optOuts: 0, confirmations: 0, templates: 0 };
  const provider = whatsappProvider();
  for (const ev of events) {
    if (ev.kind === "status") {
      const msg = await prisma.messageOutbox.findUnique({ where: { providerMessageId: ev.providerMessageId } });
      if (!msg) continue;
      if (ev.status !== "failed" && (STATUS_RANK[ev.status] ?? 0) <= (STATUS_RANK[msg.status] ?? 0)) continue;
      await prisma.messageOutbox.update({ where: { id: msg.id }, data: { status: ev.status, lastError: ev.error?.slice(0, 500) ?? msg.lastError } });
      if (ev.status === "failed" && (ev.errorCode === 131050 || ev.errorCode === 130403)) {
        await optOutCustomer(msg.tenantId, msg.toPhoneE164, `meta:${ev.errorCode}`);
      }
      stats.statuses++;
      continue;
    }
    if (ev.kind === "template_status") {
      const conns = await prisma.whatsappConnection.findMany({ where: { wabaId: ev.wabaId } });
      for (const c of conns) {
        await prisma.messageTemplate.updateMany({
          where: { tenantId: c.tenantId, providerTemplateId: ev.name, language: ev.language || "pt_BR" },
          data: { status: ev.status, rejectedReason: ev.reason, lastSyncedAt: new Date() },
        });
      }
      stats.templates++;
      continue;
    }
    // Mensagem recebida: idempotência por WAMID (a Meta reenvia por até 7 dias).
    const fresh = await prisma.webhookEvent.createMany({ data: [{ provider: "whatsapp-in", externalId: ev.messageId }], skipDuplicates: true });
    if (!fresh.count) continue;
    const conn = await prisma.whatsappConnection.findFirst({ where: { phoneNumberId: ev.phoneNumberId } });
    if (!conn || !ev.fromPhone) continue;
    stats.messages++;
    const creds = credentialsOf(conn);
    const db = tenantDb(conn.tenantId);
    if (ev.fromUserId) await db.customer.updateMany({ where: { phoneE164: ev.fromPhone }, data: { whatsappUserId: ev.fromUserId } });

    if (isOptOutText(ev.text)) {
      await optOutCustomer(conn.tenantId, ev.fromPhone, "whatsapp:texto");
      stats.optOuts++;
      await provider.sendText({ ...creds, toE164: ev.fromPhone, text: "Pronto! Você não vai mais receber mensagens automáticas. Se mudar de ideia, é só agendar de novo e marcar a opção do WhatsApp." }).catch(() => undefined);
      continue;
    }
    if (ev.type === "button" || ev.type === "interactive") {
      // Botão de resposta rápida: localiza o agendamento pela mensagem original (context.id).
      const original = ev.contextMessageId ? await prisma.messageOutbox.findUnique({ where: { providerMessageId: ev.contextMessageId } }) : null;
      if (!original?.appointmentId || original.tenantId !== conn.tenantId) continue;
      const appt = await db.appointment.findFirst({ where: { id: original.appointmentId } });
      if (!appt) continue;
      if (isQuickReply(ev.text, QR_CONFIRM)) {
        try {
          await confirmPresence(conn.tenantId, appt.id);
          stats.confirmations++;
          await provider.sendText({ ...creds, toE164: ev.fromPhone, text: "Presença confirmada! Obrigado e até lá. 💛" }).catch(() => undefined);
        } catch {
          await provider.sendText({ ...creds, toE164: ev.fromPhone, text: "Este agendamento não está mais ativo. Se precisar, agende de novo pelo nosso link." }).catch(() => undefined);
        }
      } else if (isQuickReply(ev.text, QR_RESCHEDULE)) {
        const token = await signActionToken(appt.id, conn.tenantId, actionTokenExpiry(appt.startsAt));
        const link = `${env().APP_URL.replace(/\/$/, "")}/a/${token}`;
        await provider.sendText({ ...creds, toE164: ev.fromPhone, text: `Sem problemas! Escolha um novo horário por aqui: ${link}` }).catch(() => undefined);
      }
    }
    // Outras mensagens: atendimento humano (chatbot é Fase 3).
  }
  return stats;
}

export function isAuthError(err: unknown) {
  return err instanceof WhatsappSendError && err.kind === "auth";
}
