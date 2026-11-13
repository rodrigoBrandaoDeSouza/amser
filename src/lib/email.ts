import { env } from "./env";

/**
 * Envio de e-mail transacional (redefinição de senha, verificação de conta).
 * Dev: "console" (o link aparece no log). Produção: SMTP de qualquer provedor
 * (Amazon SES, Resend, Postmark, Brevo…).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export const sentEmails: EmailMessage[] = []; // inspeção em testes/dev

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const e = env();
  if (e.EMAIL_PROVIDER === "console") {
    sentEmails.push(msg);
    if (e.NODE_ENV !== "test") console.info(`[email:console] para ${msg.to} — ${msg.subject}\n${msg.text}\n`);
    return;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE === "true",
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: e.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
}

export function appLink(path: string) {
  return `${env().APP_URL.replace(/\/$/, "")}${path}`;
}
