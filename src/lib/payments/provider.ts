import { env } from "../env";
import { hmacSha256Hex, randomToken, safeEqual } from "../crypto";

/**
 * Camada de provedores de pagamento (§9). O dinheiro vai direto para a conta
 * do tenant no PSP — o Amser só cria a cobrança e recebe o webhook.
 * PSP real a definir na Fase 0 (ADR 0003); implementar aqui um novo provider.
 */
export interface PixCharge {
  chargeId: string;
  pixCopyPaste: string;
}

export interface PaymentWebhookEvent {
  eventId: string;
  chargeId: string;
  status: "paid" | "expired";
}

export interface PaymentProvider {
  name: string;
  createPixCharge(input: {
    tenantId: string;
    appointmentId: string;
    amountCents: number;
    expiresAt: Date;
    description: string;
    credentials: unknown;
  }): Promise<PixCharge>;
  /** Valida assinatura e interpreta o webhook. Lança erro se a assinatura for inválida. */
  parseWebhook(rawBody: string, headers: Headers): PaymentWebhookEvent | null;
  /** Reembolso (total ou parcial) de uma cobrança Pix. Fase 2. */
  refund?(input: { chargeId: string; amountCents: number; credentials: unknown }): Promise<{ refundId: string }>;
}

/** Em testes: força falha nos próximos N reembolsos do mock. */
let mockRefundFailures = 0;
export function mockRefundFailNext(n: number) {
  mockRefundFailures = n;
}

export class InvalidSignatureError extends Error {}

export const MOCK_SIGNATURE_HEADER = "x-amser-signature";

export const mockPaymentProvider: PaymentProvider = {
  name: "mock",
  async createPixCharge({ amountCents }) {
    const chargeId = `mock_${randomToken(12)}`;
    const amount = (amountCents / 100).toFixed(2);
    return {
      chargeId,
      // Payload ilustrativo (não é um BR Code válido).
      pixCopyPaste: `00020126MOCK-AMSER-PIX5204000053039865404${amount}5802BR6009SAO PAULO62${chargeId}6304ABCD`,
    };
  },
  parseWebhook(rawBody, headers) {
    const sig = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    const expected = hmacSha256Hex(env().PAYMENT_WEBHOOK_SECRET, rawBody);
    if (!sig || !safeEqual(sig, expected)) throw new InvalidSignatureError("assinatura inválida");
    const body = JSON.parse(rawBody) as { id?: string; chargeId?: string; status?: string };
    if (!body.id || !body.chargeId || (body.status !== "paid" && body.status !== "expired")) return null;
    return { eventId: body.id, chargeId: body.chargeId, status: body.status };
  },
  async refund({ chargeId }) {
    if (mockRefundFailures > 0) {
      mockRefundFailures--;
      throw new Error("falha simulada no reembolso");
    }
    return { refundId: `mock_refund_${chargeId}_${randomToken(6)}` };
  },
};

export function paymentProvider(name: string = env().PAYMENT_PROVIDER): PaymentProvider {
  switch (name) {
    case "mock":
      return mockPaymentProvider;
    default:
      throw new Error(`Provedor de pagamento desconhecido: ${name}`);
  }
}

/** Usado em dev/testes para simular o PSP confirmando um Pix. */
export function signMockWebhook(body: object): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: hmacSha256Hex(env().PAYMENT_WEBHOOK_SECRET, raw) };
}
