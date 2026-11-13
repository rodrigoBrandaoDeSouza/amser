import crypto from "node:crypto";
import { env } from "./env";

/**
 * Criptografia de credenciais de integração (AES-256-GCM).
 * Formato: v1.<iv b64>.<tag b64>.<ciphertext b64>
 * Ver ADR 0004: no MVP o "cofre" é esta coluna criptografada + chave em variável protegida.
 */
function key(): Buffer {
  const raw = env().CREDENTIALS_KEY;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("CREDENTIALS_KEY deve ter 32 bytes em base64");
  return buf;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptJson<T = unknown>(payload: string): T {
  const [v, ivB64, tagB64, ctB64] = payload.split(".");
  if (v !== "v1") throw new Error("Formato de credencial desconhecido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export function hmacSha256Hex(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
