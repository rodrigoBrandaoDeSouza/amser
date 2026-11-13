import type { User } from "@prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import { appLink, sendEmail } from "../email";
import { hashPassword, verifyPassword } from "./password";
import { consumeAuthToken, createAuthToken } from "./tokens";
import { generateSecret, otpauthUrl, verifyTotp } from "./totp";

export function validatePassword(pw: string) {
  if (pw.length < 10) throw Errors.validation("A senha precisa ter ao menos 10 caracteres");
  if (pw.length > 200) throw Errors.validation("Senha longa demais");
}

/** Pedido de redefinição. Sempre responde igual (não revela se o e-mail existe). */
export async function requestPasswordReset(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "active") return;
  const token = await createAuthToken(user.id, "reset_password");
  await sendEmail({
    to: user.email,
    subject: "Redefinir sua senha do Amser",
    text: `Olá, ${user.name.split(" ")[0]}!\n\nPara criar uma nova senha, acesse (válido por 1 hora):\n${appLink(`/redefinir-senha/${token}`)}\n\nSe não foi você, ignore este e-mail.`,
  });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.reset_requested", resource: `user:${user.id}` });
}

export async function resetPassword(token: string, newPassword: string) {
  validatePassword(newPassword);
  const userId = await consumeAuthToken(token, "reset_password");
  if (!userId) throw Errors.validation("Link inválido ou expirado. Peça um novo.");
  // Encerra todas as sessões abertas (sessionsValidAfter).
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword), sessionsValidAfter: new Date() } });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.password_reset", resource: `user:${user.id}` });
  return user;
}

export async function changePassword(user: User, current: string, next: string) {
  if (!(await verifyPassword(current, user.passwordHash))) throw Errors.validation("Senha atual incorreta");
  validatePassword(next);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), sessionsValidAfter: new Date() } });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.password_change", resource: `user:${user.id}` });
}

export async function sendVerificationEmail(user: User) {
  if (user.emailVerifiedAt) return;
  const token = await createAuthToken(user.id, "verify_email");
  await sendEmail({
    to: user.email,
    subject: "Confirme seu e-mail no Amser",
    text: `Olá, ${user.name.split(" ")[0]}!\n\nConfirme seu e-mail para proteger sua conta:\n${appLink(`/verificar-email/${token}`)}\n\nO link vale por 7 dias.`,
  });
}

export async function verifyEmail(token: string) {
  const userId = await consumeAuthToken(token, "verify_email");
  if (!userId) throw Errors.validation("Link inválido ou expirado");
  return prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

// ---------------------------------------------------------------- MFA (TOTP)

/** Gera um segredo novo (ainda não ativo) e devolve a URL otpauth para o QR code. */
export async function beginMfaSetup(user: User) {
  if (user.mfaEnabledAt) throw Errors.policy("A verificação em duas etapas já está ativa");
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: encryptJson({ secret }) } });
  return { secret, url: otpauthUrl(secret, user.email) };
}

function secretOf(user: User): string | null {
  return user.mfaSecretEncrypted ? decryptJson<{ secret: string }>(user.mfaSecretEncrypted).secret : null;
}

export async function confirmMfaSetup(user: User, code: string) {
  const secret = secretOf(user);
  if (!secret) throw Errors.policy("Comece a configuração novamente");
  if (!verifyTotp(secret, code)) throw Errors.validation("Código incorreto. Confira o horário do celular e tente de novo.");
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.mfa_enabled", resource: `user:${user.id}` });
}

export async function disableMfa(user: User, code: string) {
  const secret = secretOf(user);
  if (!user.mfaEnabledAt || !secret) return;
  if (!verifyTotp(secret, code)) throw Errors.validation("Código incorreto");
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null } });
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.mfa_disabled", resource: `user:${user.id}` });
}

export function checkMfaCode(user: User, code: string): boolean {
  const secret = secretOf(user);
  return !!user.mfaEnabledAt && !!secret && verifyTotp(secret, code);
}
