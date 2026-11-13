import { prisma, isUniqueViolation } from "../db";
import { audit } from "../audit";
import { paymentProvider, InvalidSignatureError } from "./provider";
import { scheduleAppointmentMessagesSafe } from "../whatsapp/outbox";

export type WebhookResult =
  | { ok: true; outcome: "confirmed" | "late_payment" | "duplicate" | "ignored" | "expired" }
  | { ok: false; status: number; reason: string };

/**
 * Webhook do PSP (§9). Garantias:
 *  - assinatura verificada antes de qualquer efeito;
 *  - idempotente por evento (webhook_events) e por estado (updates condicionais);
 *  - Pix pago confirma o agendamento UMA vez; pagamento após expiração não
 *    "ressuscita" o horário — fica marcado para reembolso.
 */
export async function handlePaymentWebhook(providerName: string, rawBody: string, headers: Headers): Promise<WebhookResult> {
  let event;
  try {
    event = paymentProvider(providerName).parseWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof InvalidSignatureError) return { ok: false, status: 401, reason: "assinatura inválida" };
    return { ok: false, status: 400, reason: "payload inválido" };
  }
  if (!event) return { ok: true, outcome: "ignored" };

  try {
    await prisma.webhookEvent.create({ data: { provider: providerName, externalId: event.eventId } });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, outcome: "duplicate" };
    throw err;
  }

  const payment = await prisma.payment.findUnique({ where: { providerChargeId: event.chargeId } });
  if (!payment) return { ok: true, outcome: "ignored" };

  if (event.status === "expired") {
    await prisma.payment.updateMany({ where: { id: payment.id, status: "pending" }, data: { status: "expired" } });
    return { ok: true, outcome: "expired" };
  }

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const marked = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["pending", "expired"] } },
      data: { status: "paid", paidAt: now },
    });
    if (marked.count !== 1) return "duplicate" as const;

    const confirmed = await tx.appointment.updateMany({
      where: { id: payment.appointmentId, tenantId: payment.tenantId, status: "aguardando_sinal" },
      data: { status: "confirmado", holdExpiresAt: null, confirmedPresenceAt: null },
    });
    if (confirmed.count === 1) {
      await tx.appointmentEvent.create({
        data: {
          tenantId: payment.tenantId,
          appointmentId: payment.appointmentId,
          eventType: "deposit_paid",
          payloadJson: { amountCents: payment.amountCents },
        },
      });
      return "confirmed" as const;
    }
    // O horário já expirou/cancelou: guarda o pagamento e sinaliza reembolso.
    await tx.payment.update({ where: { id: payment.id }, data: { needsRefund: true } });
    await audit(
      {
        tenantId: payment.tenantId,
        action: "payment.late",
        resource: `payment:${payment.id}`,
        meta: { appointmentId: payment.appointmentId },
      },
      tx,
    );
    return "late_payment" as const;
  });

  if (outcome === "confirmed") await scheduleAppointmentMessagesSafe(payment.appointmentId, "booked");
  return { ok: true, outcome };
}
