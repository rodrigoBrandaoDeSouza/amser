import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth/session";
import { connectInstagram, verifyOAuthState } from "@/lib/instagram/service";
import { safeEqual } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

/** Retorno do Instagram Login: valida state (assinado + cookie + mesmo usuário) e salva o token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/painel/marca/instagram?${q}`, req.url));
  if (url.searchParams.get("error")) return back("erro=" + encodeURIComponent("Conexão cancelada no Instagram"));

  const user = await currentUser();
  const state = await verifyOAuthState(url.searchParams.get("state") ?? "");
  const cookieNonce = (await cookies()).get("amser_ig_state")?.value ?? "";
  if (!user || !state || state.uid !== user.id || state.tid !== user.tenantId || !cookieNonce || !safeEqual(cookieNonce, state.nonce)) {
    return back("erro=" + encodeURIComponent("Sessão de conexão inválida. Tente novamente."));
  }
  const code = url.searchParams.get("code");
  if (!code) return back("erro=" + encodeURIComponent("Código ausente"));
  try {
    await connectInstagram(state.tid, user.id, code);
  } catch (err) {
    console.error("[instagram] callback", err instanceof Error ? err.message : err);
    return back("erro=" + encodeURIComponent(err instanceof AppError ? err.message : "Não foi possível conectar ao Instagram"));
  }
  const res = back("ok=" + encodeURIComponent("Instagram conectado"));
  res.cookies.delete("amser_ig_state");
  return res;
}
