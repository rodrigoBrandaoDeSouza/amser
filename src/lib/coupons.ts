import type { Coupon, Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { Errors } from "./errors";

type Tx = Prisma.TransactionClient;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
}

export function discountFor(coupon: Pick<Coupon, "discountType" | "discountValue">, priceCents: number): number {
  if (priceCents <= 0) return 0;
  if (coupon.discountType === "percent") return Math.round((priceCents * Math.min(100, Math.max(0, coupon.discountValue))) / 100);
  return Math.min(priceCents, Math.max(0, coupon.discountValue));
}

/**
 * Valida um cupom para um serviço (sem consumir). Mensagens seguras para o
 * cliente final; não revela se o código existe em outro tenant.
 */
export async function quoteCoupon(params: {
  tenantId: string;
  code: string;
  serviceId: string;
  priceCents: number;
  customerId?: string | null;
  now?: Date;
}): Promise<{ coupon: Coupon; discountCents: number }> {
  const now = params.now ?? new Date();
  const code = normalizeCode(params.code);
  if (!code) throw Errors.validation("Cupom inválido");
  const db = tenantDb(params.tenantId);
  const coupon = await db.coupon.findFirst({ where: { code } });
  const invalid = () => Errors.validation("Cupom inválido ou expirado");
  if (!coupon || !coupon.active) throw invalid();
  if (coupon.validFrom && coupon.validFrom > now) throw invalid();
  if (coupon.validUntil && coupon.validUntil < now) throw invalid();
  if (coupon.maxRedemptions !== null && coupon.redemptionsCount >= coupon.maxRedemptions) throw Errors.validation("Cupom esgotado");
  if (coupon.serviceIds.length && !coupon.serviceIds.includes(params.serviceId)) throw Errors.validation("Cupom não vale para este serviço");
  if (params.customerId) {
    const used = await db.appointment.count({ where: { couponId: coupon.id, customerId: params.customerId, status: { notIn: ["expirado"] } } });
    if (used >= coupon.maxPerCustomer) throw Errors.validation("Você já usou este cupom");
  }
  return { coupon, discountCents: discountFor(coupon, params.priceCents) };
}

/** Consome um uso de forma atômica (respeita o limite mesmo sob concorrência). */
export async function redeemCoupon(tx: Tx, couponId: string): Promise<void> {
  const n = await tx.$executeRaw`
    UPDATE coupons SET redemptions_count = redemptions_count + 1
    WHERE id = ${couponId} AND active
      AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)`;
  if (n !== 1) throw Errors.validation("Cupom esgotado");
}

/** Devolve o uso quando a reserva expira sem pagamento. */
export async function releaseCoupon(tx: Tx, couponId: string): Promise<void> {
  await tx.$executeRaw`UPDATE coupons SET redemptions_count = redemptions_count - 1 WHERE id = ${couponId} AND redemptions_count > 0`;
}
