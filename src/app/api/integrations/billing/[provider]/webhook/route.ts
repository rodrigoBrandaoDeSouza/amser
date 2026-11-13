import { handleBillingWebhook } from "@/lib/billing/service";
import { json } from "@/lib/http";

/** Webhook do PSP de cobrança da assinatura (Fase 2). Assinado e idempotente. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9-]{2,30}$/.test(provider)) return json({ error: "provider" }, { status: 404 });
  try {
    const res = await handleBillingWebhook(provider, await req.text(), req.headers);
    if (!res.ok) return json({ error: res.reason }, { status: res.status });
    return json({ received: true, outcome: res.outcome });
  } catch (err) {
    console.error("[webhook:cobrança]", err instanceof Error ? err.message : err);
    return json({ error: "internal" }, { status: 500 });
  }
}
