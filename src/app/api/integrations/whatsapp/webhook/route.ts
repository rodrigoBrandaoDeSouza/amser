import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { whatsappProvider } from "@/lib/whatsapp/provider";
import { handleWhatsappEvents } from "@/lib/whatsapp/service";
import { json } from "@/lib/http";

/** Verificação do webhook pela Meta: devolve hub.challenge se o verify_token confere. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  if (url.searchParams.get("hub.mode") === "subscribe" && expected && safeEqual(token, expected)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/**
 * Eventos da Meta: status de entrega, mensagens recebidas (opt-out, respostas
 * rápidas) e mudança de status de templates. Assinatura X-Hub-Signature-256
 * obrigatória. A Meta reenvia por até 7 dias em caso de erro → idempotente.
 */
export async function POST(req: Request) {
  const provider = whatsappProvider();
  if (provider.name === "mock" && env().NODE_ENV === "production") return json({ error: "not configured" }, { status: 404 });
  const raw = await req.text();
  let events;
  try {
    events = provider.parseWebhook(raw, req.headers);
  } catch {
    return json({ error: "assinatura inválida" }, { status: 401 });
  }
  try {
    const stats = await handleWhatsappEvents(events);
    return json({ received: true, ...stats });
  } catch (err) {
    console.error("[webhook:whatsapp]", err instanceof Error ? err.message : err);
    return json({ error: "internal" }, { status: 500 });
  }
}
