import { z } from "zod";
import { env } from "@/lib/env";
import { verifyActionToken } from "@/lib/tokens";
import { prisma } from "@/lib/db";
import { signMockWebhook, MOCK_SIGNATURE_HEADER } from "@/lib/payments/provider";
import { handlePaymentWebhook } from "@/lib/payments/service";
import { json } from "@/lib/http";

/** SOMENTE DEV: simula o PSP confirmando o Pix do agendamento. */
export async function POST(req: Request) {
  if (env().NODE_ENV === "production" || env().PAYMENT_PROVIDER !== "mock") return json({ error: "not found" }, { status: 404 });
  const body = z.object({ token: z.string() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "token" }, { status: 400 });
  const claims = await verifyActionToken(body.data.token);
  if (!claims) return json({ error: "token" }, { status: 404 });
  const pay = await prisma.payment.findFirst({ where: { appointmentId: claims.aid, tenantId: claims.tid, status: "pending" } });
  if (!pay) return json({ error: "sem cobrança pendente" }, { status: 404 });
  const { raw, signature } = signMockWebhook({ id: `evt_${Date.now()}`, chargeId: pay.providerChargeId, status: "paid" });
  return json(await handlePaymentWebhook("mock", raw, new Headers({ [MOCK_SIGNATURE_HEADER]: signature })));
}
