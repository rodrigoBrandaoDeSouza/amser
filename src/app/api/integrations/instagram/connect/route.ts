import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { createOAuthState, redirectUri } from "@/lib/instagram/service";
import { instagramProvider } from "@/lib/instagram/provider";
import { isProd } from "@/lib/env";
import { isEnabled } from "@/lib/flags";

/** Inicia o Instagram Login (só o dono, logado). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.tenantId || user.role !== "owner") return NextResponse.redirect(new URL("/login", req.url));
  const provider = (await isEnabled("instagram_import", user.tenantId)) ? instagramProvider() : null;
  if (!provider) return NextResponse.redirect(new URL("/painel/marca/instagram?erro=Integra%C3%A7%C3%A3o+indispon%C3%ADvel", req.url));
  const { state, nonce } = await createOAuthState(user.id, user.tenantId);
  const res = NextResponse.redirect(provider.authorizeUrl(state, redirectUri()));
  res.cookies.set("amser_ig_state", nonce, { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/api/integrations/instagram", maxAge: 600 });
  return res;
}
