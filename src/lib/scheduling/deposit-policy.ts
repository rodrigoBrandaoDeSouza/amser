import type { DepositRefundMode, Payment, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { decryptJson } from "../crypto";
import { paymentProvider } from "../payments/provider";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Saldo de crédito do cliente (soma do razão). */
export async function creditBalance(tx: Tx, tenantId: string, customerId: string): Promise<number> {
  const r = await tx.customerCredit.aggregate({ where: { tenantId, customerId }, _sum: { amountCents: true } });
  return Math.max(0, r._sum.amountCents ?? 0);
}

export interface Settlement {
  retainCents: number; // fica com a empresa
  creditBackCents: number; // volta como crédito (inclui o crédito que tinha sido usado)
  refundCents: number; // devolver via PSP
}

/**
 * Política avançada de sinal (Fase 2). O sinal total = Pix pago + crédito usado.
 *  - retainPercent: quanto a empresa retém (0–100).
 *  - O crédito usado volta primeiro como crédito; o restante do Pix vai como
 *    reembolso ou crédito, conforme o modo do tenant.
 */
export function computeSettlement(params: {
  pixPaidCents: number;
  creditAppliedCents: number;
  retainPercent: number;
  mode: DepositRefundMode;
}): Settlement {
  const total = params.pixPaidCents + params.creditAppliedCents;
  const pct = Math.min(100, Math.max(0, params.retainPercent));
  const retainCents = Math.round((total * pct) / 100);
  const returnable = total - retainCents;
  const creditPart = Math.min(params.creditAppliedCents, returnable);
  const pixBack = returnable - creditPart;
  return params.mode === "credit"
    ? { retainCents, creditBackCents: creditPart + pixBack, refundCents: 0 }
    : { retainCents, creditBackCents: creditPart, refundCents: pixBack };
}

/**
 * Aplica a liquidação dentro da transação. O reembolso via PSP NÃO é feito aqui
 * (chamada externa): marca needsRefund e o valor; `processRefund` executa depois.
 */
export async function applySettlement(
  tx: Prisma.TransactionClient,
  args: { tenantId: string; customerId: string; appointmentId: string; payment: Payment | null; settlement: Settlement; reason: string },
) {
  const { settlement: s, payment } = args;
  if (s.creditBackCents > 0) {
    await tx.customerCredit.create({
      data: { tenantId: args.tenantId, customerId: args.customerId, appointmentId: args.appointmentId, amountCents: s.creditBackCents, reason: args.reason },
    });
  }
  if (payment) {
    const pixRetained = Math.min(payment.amountCents, s.retainCents);
    const credited = Math.max(0, payment.amountCents - pixRetained - s.refundCents);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        retainedCents: pixRetained,
        creditedCents: credited,
        needsRefund: s.refundCents > 0,
        refundedCents: 0,
        status: s.refundCents > 0 ? payment.status : pixRetained > 0 ? "retained" : credited > 0 ? "credited" : "refunded",
      },
    });
  }
}

/** Reembolso automático via PSP. Em falha, fica pendente para nova tentativa/manual. */
export async function processRefund(paymentId: string): Promise<"refunded" | "failed" | "noop"> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p || !p.needsRefund) return "noop";
  const amount = p.amountCents - p.retainedCents - p.creditedCents - p.refundedCents;
  if (amount <= 0) {
    await prisma.payment.update({ where: { id: p.id }, data: { needsRefund: false } });
    return "noop";
  }
  try {
    const conn = await prisma.paymentConnection.findFirst({ where: { tenantId: p.tenantId, provider: p.provider } });
    const provider = paymentProvider(p.provider);
    if (!provider.refund) return "failed";
    const { refundId } = await provider.refund({
      chargeId: p.providerChargeId,
      amountCents: amount,
      credentials: conn?.encryptedCredentials ? decryptJson(conn.encryptedCredentials) : null,
    });
    await prisma.payment.updateMany({
      where: { id: p.id, needsRefund: true },
      data: {
        needsRefund: false,
        refundedCents: { increment: amount },
        providerRefundId: refundId,
        refundedAt: new Date(),
        status: p.retainedCents > 0 ? "retained" : "refunded",
      },
    });
    return "refunded";
  } catch (err) {
    console.error("[reembolso] falha", p.id, err instanceof Error ? err.message : err);
    return "failed";
  }
}

export async function processRefundSafe(paymentId: string | null | undefined) {
  if (paymentId) await processRefund(paymentId).catch(() => undefined);
}
