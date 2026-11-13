import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { whatsappProvider } from "@/lib/whatsapp/provider";
import { json } from "@/lib/http";

/** Verificação do webhook pela Meta (hub.challenge). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const expected = env().WHATSAPP_VERIFY_TOKEN;
  if (url.searchParams.get("hub.mode") === "subscribe" && expected && safeEqual(token, expected)) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/** Status de entrega (sent/delivered/read/failed). Assinatura X-Hub-Signature-256 obrigatória. */
export async function POST(req: Request) {
  const raw = await req.text();
  let updates;
  try {
    updates = whatsappProvider().parseStatusWebhook(raw, req.headers);
  } catch {
    return json({ error: "assinatura inválida" }, { status: 401 });
  }
  for (const u of updates) {
    const msg = await prisma.messageOutbox.findUnique({ where: { providerMessageId: u.providerMessageId } });
    if (!msg) continue;
    // Ignora eventos fora de ordem (ex.: "sent" chegando depois de "read").
    if (u.status !== "failed" && (RANK[u.status] ?? 0) <= (RANK[msg.status] ?? 0)) continue;
    await prisma.messageOutbox.update({
      where: { id: msg.id },
      data: { status: u.status, lastError: u.error?.slice(0, 500) ?? msg.lastError },
    });
  }
  return json({ received: true });
}
