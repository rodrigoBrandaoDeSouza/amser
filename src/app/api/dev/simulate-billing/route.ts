import { env } from "@/lib/env";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { signMockBillingWebhook, BILLING_SIGNATURE_HEADER } from "@/lib/billing/provider";
import { handleBillingWebhook } from "@/lib/billing/service";
import { json } from "@/lib/http";

/** SOMENTE DEV: simula o pagamento da fatura aberta mais antiga do tenant do usuário logado. */
export async function POST() {
  if (env().NODE_ENV === "production" || env().BILLING_PROVIDER !== "mock") return json({ error: "not found" }, { status: 404 });
  const user = await currentUser();
  if (!user?.tenantId || user.role !== "owner") return json({ error: "unauthorized" }, { status: 401 });
  const inv = await prisma.billingInvoice.findFirst({ where: { tenantId: user.tenantId, status: "open" }, orderBy: { dueAt: "asc" } });
  if (!inv) return json({ error: "sem fatura aberta" }, { status: 404 });
  const { raw, signature } = signMockBillingWebhook({ id: `evt_bill_${Date.now()}`, chargeId: inv.providerChargeId, status: "paid" });
  return json(await handleBillingWebhook("billing-mock", raw, new Headers({ [BILLING_SIGNATURE_HEADER]: signature })));
}
