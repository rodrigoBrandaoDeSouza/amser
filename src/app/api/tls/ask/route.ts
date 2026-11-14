import { canIssueCertificate } from "@/lib/domains";

/**
 * GET /api/tls/ask?domain=… — consultado pelo Caddy antes de emitir HTTPS
 * para um domínio (deploy em VPS, ver docs/deploy-vps.md). 200 = pode emitir.
 */
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain") ?? "";
  const ok = await canIssueCertificate(domain).catch(() => false);
  return new Response(null, { status: ok ? 200 : 404 });
}
