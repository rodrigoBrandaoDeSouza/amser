import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

/**
 * Serve imagens de marca, apenas de empresas visíveis (ativas, em onboarding
 * ou com prévia não expirada). São fotos de divulgação enviadas pelo negócio.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/.test(id)) return new Response("not found", { status: 404 });
  const media = await prisma.tenantMedia.findUnique({ where: { id }, include: { tenant: true } });
  const t = media?.tenant;
  const visible =
    !!t &&
    (t.status === "active" || t.status === "onboarding" || (t.status === "prospect" && !!t.previewExpiresAt && t.previewExpiresAt > new Date()));
  if (!media || !visible || !media.rightsConfirmed) return new Response("not found", { status: 404 });
  const data = await storage().get(media.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": media.mimeType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
