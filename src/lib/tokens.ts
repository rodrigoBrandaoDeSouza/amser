import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

/**
 * Tokens de ação do cliente final (links do WhatsApp e página de status do
 * agendamento). Assinados (HS256), temporários e presos a um agendamento +
 * tenant. Não dão acesso a nenhum outro recurso.
 */
export type ActionPurpose = "manage"; // ver, confirmar presença, remarcar, cancelar, pagar

interface ActionClaims {
  aid: string; // appointment id
  tid: string; // tenant id
  pur: ActionPurpose;
}

const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function signActionToken(appointmentId: string, tenantId: string, expiresAt: Date): Promise<string> {
  return new SignJWT({ aid: appointmentId, tid: tenantId, pur: "manage" } satisfies ActionClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("amser:action")
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
}

export async function verifyActionToken(token: string): Promise<ActionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "amser:action", algorithms: ["HS256"] });
    if (typeof payload.aid !== "string" || typeof payload.tid !== "string" || payload.pur !== "manage") return null;
    return { aid: payload.aid, tid: payload.tid, pur: "manage" };
  } catch {
    return null;
  }
}

/** Expiração padrão do link: 7 dias após o horário do atendimento. */
export function actionTokenExpiry(startsAt: Date): Date {
  return new Date(startsAt.getTime() + 7 * 24 * 3600_000);
}
