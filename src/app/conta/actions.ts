"use server";

import { redirect } from "next/navigation";
import { currentUser, destroySession } from "@/lib/auth/session";
import { runAction, str } from "@/lib/actions";
import { beginMfaSetup, changePassword, confirmMfaSetup, disableMfa, sendVerificationEmail } from "@/lib/auth/account";
import { rateLimit } from "@/lib/rate-limit";
import { AppError, Errors } from "@/lib/errors";

async function me() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function changePasswordAction(fd: FormData) {
  const user = await me();
  if (str(fd, "next") !== str(fd, "confirm")) redirect("/conta?erro=" + encodeURIComponent("As senhas novas não conferem"));
  let error: string | null = null;
  try {
    await changePassword(user, str(fd, "current"), str(fd, "next"));
  } catch (e) {
    error = e instanceof AppError ? e.message : "Não foi possível trocar a senha";
  }
  if (error) redirect("/conta?erro=" + encodeURIComponent(error));
  // Senha trocada encerra todas as sessões — inclusive esta.
  await destroySession();
  redirect("/login?ok=" + encodeURIComponent("Senha alterada. Entre novamente."));
}

export async function beginMfaAction() {
  const user = await me();
  await runAction("/conta?mfa=configurar", async () => {
    await beginMfaSetup(user);
    return "Escaneie o QR code com o app autenticador e digite o código.";
  });
}

export async function confirmMfaAction(fd: FormData) {
  const user = await me();
  if (!rateLimit(`mfa-setup:${user.id}`, 10, 10 * 60_000)) throw Errors.rateLimited();
  await runAction("/conta", async () => {
    await confirmMfaSetup(user, str(fd, "code"));
    return "Verificação em duas etapas ativada";
  });
}

export async function disableMfaAction(fd: FormData) {
  const user = await me();
  await runAction("/conta", async () => {
    await disableMfa(user, str(fd, "code"));
    return "Verificação em duas etapas desativada";
  });
}

export async function resendVerificationAction() {
  const user = await me();
  await runAction("/conta", async () => {
    if (!rateLimit(`verify-mail:${user.id}`, 3, 60 * 60_000)) throw Errors.rateLimited();
    await sendVerificationEmail(user);
    return `Enviamos um link para ${user.email}`;
  });
}
