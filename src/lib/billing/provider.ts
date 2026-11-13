import { env } from "../env";
import { hmacSha256Hex, randomToken, safeEqual } from "../crypto";

/**
 * Cobrança da assinatura do SaaS (Fase 2). Recebedor: o Amser (diferente do
 * sinal, que cai na conta do tenant). PSP de cobrança a definir na Fase 0;
 * implementar aqui um novo provider (Asaas, Pagar.me, Mercado Pago…).
 */
export interface BillingCharge {
  chargeId: string;
  pixCopyPaste: string | null;
}

export interface BillingWebhookEvent {
  eventId: string;
  chargeId: string;
  status: "paid";
}

export interface BillingProvider {
  name: string;
  createCharge(input: { tenantId: string; amountCents: number; dueAt: Date; description: string }): Promise<BillingCharge>;
  parseWebhook(rawBody: string, headers: Headers): BillingWebhookEvent | null;
}

export const BILLING_SIGNATURE_HEADER = "x-amser-signature";

export const mockBillingProvider: BillingProvider = {
  name: "billing-mock",
  async createCharge({ amountCents }) {
    const chargeId = `bill_mock_${randomToken(10)}`;
    return { chargeId, pixCopyPaste: `00020126MOCK-AMSER-ASSINATURA54${(amountCents / 100).toFixed(2)}62${chargeId}` };
  },
  parseWebhook(rawBody, headers) {
    const sig = headers.get(BILLING_SIGNATURE_HEADER) ?? "";
    if (!sig || !safeEqual(sig, hmacSha256Hex(env().BILLING_WEBHOOK_SECRET, rawBody))) throw new Error("assinatura inválida");
    const b = JSON.parse(rawBody) as { id?: string; chargeId?: string; status?: string };
    if (!b.id || !b.chargeId || b.status !== "paid") return null;
    return { eventId: b.id, chargeId: b.chargeId, status: "paid" };
  },
};

export function billingProvider(name: string = env().BILLING_PROVIDER): BillingProvider {
  if (name === "mock" || name === "billing-mock" || name === "none") return mockBillingProvider;
  throw new Error(`Provedor de cobrança desconhecido: ${name}`);
}

export function signMockBillingWebhook(body: object) {
  const raw = JSON.stringify(body);
  return { raw, signature: hmacSha256Hex(env().BILLING_WEBHOOK_SECRET, raw) };
}
