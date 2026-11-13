import crypto from "node:crypto";
import { prisma } from "../db";

/**
 * Tokens de uso único (link de e-mail). Só o hash SHA-256 fica no banco;
 * o token em claro existe apenas no link enviado.
 */
export type AuthPurpose = "reset_password" | "verify_email";

const TTL: Record<AuthPurpose, number> = {
  reset_password: 60 * 60_000, // 1 hora
  verify_email: 7 * 24 * 3600_000, // 7 dias
};

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

export async function createAuthToken(userId: string, purpose: AuthPurpose): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  // Invalida tokens anteriores do mesmo tipo.
  await prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.authToken.create({ data: { userId, purpose, tokenHash: hash(raw), expiresAt: new Date(Date.now() + TTL[purpose]) } });
  return raw;
}

/** Consome o token (uma única vez). Retorna o userId ou null. */
export async function consumeAuthToken(raw: string, purpose: AuthPurpose): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(raw)) return null;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) return null;
  const r = await prisma.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return r.count === 1 ? t.userId : null;
}

/** Verifica sem consumir (para exibir o formulário). */
export async function peekAuthToken(raw: string, purpose: AuthPurpose): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(raw)) return false;
  const t = await prisma.authToken.findUnique({ where: { tokenHash: hash(raw) } });
  return !!t && t.purpose === purpose && !t.usedAt && t.expiresAt > new Date();
}
