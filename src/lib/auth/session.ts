import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "@prisma/client";
import { prisma, tenantDb } from "../db";
import { env, isProd } from "../env";

const COOKIE = "amser_session";
const MAX_AGE_S = 7 * 24 * 3600;
const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export { hashPassword, verifyPassword } from "./password";

export async function createSession(user: User) {
  const jwt = await new SignJWT({ uid: user.id, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("amser:session")
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Usuário atual, recarregado do banco a cada requisição (status/role atualizados). */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "amser:session", algorithms: ["HS256"] });
    if (typeof payload.uid !== "string") return null;
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user || user.status !== "active") return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireSuperadmin(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") redirect("/painel");
  return user;
}

/**
 * Contexto do painel da empresa. O tenantId vem SEMPRE do usuário autenticado.
 * Staff só acessa o que `allowStaff` permitir.
 */
export async function requireTenantUser(opts: { allowStaff?: boolean; allowBillingSuspended?: boolean } = {}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "superadmin") redirect("/admin");
  if (!user.tenantId) redirect("/login");
  if (user.role === "staff" && !opts.allowStaff) redirect("/painel/agenda");
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
  // Suspensão por cobrança: o dono ainda acessa a página do plano para pagar.
  const billingSuspended = tenant?.status === "suspended" && tenant.suspendedReason === "billing" && user.role === "owner";
  if (billingSuspended && !opts.allowBillingSuspended) redirect("/painel/plano");
  if (!tenant || tenant.status === "deleted" || (tenant.status === "suspended" && !billingSuspended) || tenant.status === "prospect") {
    redirect("/login?erro=empresa-indisponivel");
  }
  const professional =
    user.role === "staff" ? await tenantDb(tenant.id).professional.findFirst({ where: { userId: user.id } }) : null;
  return { user, tenant, db: tenantDb(tenant.id), professional };
}
