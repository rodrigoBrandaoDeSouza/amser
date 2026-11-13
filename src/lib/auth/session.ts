import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "@prisma/client";
import { prisma, tenantDb } from "../db";
import { env, isProd } from "../env";
import { can, type StaffPermission } from "./permissions";

const COOKIE = "amser_session";
const MFA_COOKIE = "amser_mfa";
const MAX_AGE_S = 7 * 24 * 3600;
const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export { hashPassword, verifyPassword } from "./password";

const cookieOpts = (maxAge: number) => ({ httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/", maxAge });

/**
 * Sessão em JWT (cookie httpOnly). `sup` = tenant em que um superadmin está
 * em modo suporte (só enquanto o dono autorizar — tenants.support_access_until).
 */
export async function createSession(user: User, opts: { supportTenantId?: string } = {}) {
  const jwt = await new SignJWT({ uid: user.id, role: user.role, ...(opts.supportTenantId ? { sup: opts.supportTenantId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("amser:session")
    .setExpirationTime(opts.supportTenantId ? "2h" : `${MAX_AGE_S}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, jwt, cookieOpts(opts.supportTenantId ? 7200 : MAX_AGE_S));
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete(MFA_COOKIE);
}

interface SessionInfo {
  user: User;
  supportTenantId: string | null;
}

/** Sessão atual, com o usuário recarregado do banco (status/role sempre atualizados). */
export async function currentSession(): Promise<SessionInfo | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "amser:session", algorithms: ["HS256"] });
    if (typeof payload.uid !== "string") return null;
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user || user.status !== "active") return null;
    // Troca/redefinição de senha invalida sessões emitidas antes.
    if (user.sessionsValidAfter && (payload.iat ?? 0) * 1000 < user.sessionsValidAfter.getTime() - 1000) return null;
    const sup = typeof payload.sup === "string" && user.role === "superadmin" ? payload.sup : null;
    return { user, supportTenantId: sup };
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  return (await currentSession())?.user ?? null;
}

// ---------------------------------------------------------------- MFA (2º passo do login)

export async function setPendingMfa(userId: string) {
  const jwt = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: "HS256" }).setAudience("amser:mfa").setExpirationTime("5m").sign(secret());
  (await cookies()).set(MFA_COOKIE, jwt, cookieOpts(300));
}

export async function pendingMfaUser(): Promise<User | null> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "amser:mfa", algorithms: ["HS256"] });
    return typeof payload.uid === "string" ? prisma.user.findUnique({ where: { id: payload.uid } }) : null;
  } catch {
    return null;
  }
}

export async function clearPendingMfa() {
  (await cookies()).delete(MFA_COOKIE);
}

// ---------------------------------------------------------------- guards

export async function requireSuperadmin(): Promise<User> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.user.role !== "superadmin") redirect("/painel");
  return s.user;
}

/**
 * Contexto do painel da empresa. O tenantId vem SEMPRE da sessão (usuário,
 * ou modo suporte autorizado pelo dono). Staff só acessa o que suas
 * permissões permitirem.
 */
export async function requireTenantUser(opts: { allowStaff?: boolean; allowBillingSuspended?: boolean; permission?: StaffPermission } = {}) {
  const s = await currentSession();
  if (!s) redirect("/login");
  let user = s.user;
  let support = false;

  if (user.role === "superadmin") {
    if (!s.supportTenantId) redirect("/admin");
    const t = await prisma.tenant.findUnique({ where: { id: s.supportTenantId } });
    if (!t?.supportAccessUntil || t.supportAccessUntil < new Date()) redirect("/admin?erro=" + encodeURIComponent("Acesso de suporte expirado ou não autorizado pelo dono"));
    // Age como dono, mas o actorId registrado na auditoria é o do superadmin.
    user = { ...user, role: "owner", tenantId: t.id };
    support = true;
  }

  if (!user.tenantId) redirect("/login");
  if (user.role === "staff") {
    if (!opts.allowStaff && !(opts.permission && can(user, opts.permission))) redirect("/painel/agenda");
    if (opts.permission && !can(user, opts.permission)) redirect("/painel/agenda");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
  // Suspensão por cobrança: o dono ainda acessa a página do plano para pagar.
  const billingSuspended = tenant?.status === "suspended" && tenant.suspendedReason === "billing" && user.role === "owner";
  if (billingSuspended && !opts.allowBillingSuspended) redirect("/painel/plano");
  if (!tenant || tenant.status === "deleted" || (tenant.status === "suspended" && !billingSuspended) || tenant.status === "prospect") {
    redirect("/login?erro=empresa-indisponivel");
  }
  const professional = user.role === "staff" ? await tenantDb(tenant.id).professional.findFirst({ where: { userId: user.id } }) : null;
  return { user, tenant, db: tenantDb(tenant.id), professional, support };
}
