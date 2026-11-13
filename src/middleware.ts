import { NextResponse, type NextRequest } from "next/server";

/**
 * Domínio próprio (Fase 2): requisições a um host que não é o do Amser são
 * reescritas para /d/{host}, que resolve o tenant pelo domínio verificado.
 * Painel e admin ficam só no domínio do Amser.
 */
function appHosts(): string[] {
  const hosts = ["localhost", "127.0.0.1"];
  try {
    if (process.env.APP_URL) hosts.push(new URL(process.env.APP_URL).hostname);
  } catch {
    /* ignore */
  }
  for (const h of (process.env.APP_HOSTS ?? "").split(",")) if (h.trim()) hosts.push(h.trim().toLowerCase());
  return hosts;
}

const PASSTHROUGH = ["/api/", "/_next/", "/a/", "/w/", "/favicon", "/robots.txt"];
const APP_ONLY = ["/painel", "/admin", "/login", "/cadastro", "/marca-preview", "/preview"];

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (!host || appHosts().includes(host) || host.endsWith(".railway.app")) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PASSTHROUGH.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (APP_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const app = process.env.APP_URL ?? "";
    return app ? NextResponse.redirect(new URL(pathname, app)) : NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = `/d/${encodeURIComponent(host)}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
