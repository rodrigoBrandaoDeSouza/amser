import { handlePaymentWebhook } from "@/lib/payments/service";
import { json } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9-]{2,30}$/.test(provider)) return json({ error: "provider" }, { status: 404 });
  const raw = await req.text();
  try {
    const res = await handlePaymentWebhook(provider, raw, req.headers);
    if (!res.ok) return json({ error: res.reason }, { status: res.status });
    return json({ received: true, outcome: res.outcome });
  } catch (err) {
    console.error("[webhook:pagamento]", err instanceof Error ? err.message : err);
    // 500 → o PSP reenvia; o processamento é idempotente.
    return json({ error: "internal" }, { status: 500 });
  }
}
