import { SignJWT, jwtVerify } from "jose";
import { prisma, tenantDb } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { decryptJson, encryptJson, randomToken } from "../crypto";
import { audit } from "../audit";
import { uploadTenantImage } from "../tenants";
import { instagramProvider, type IgMedia } from "./provider";

export const MAX_IMPORT = 10;

export function redirectUri() {
  return `${env().APP_URL.replace(/\/$/, "")}/api/integrations/instagram/callback`;
}

const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

/** state do OAuth: assinado, curto e preso ao usuário + tenant (anti-CSRF). */
export async function createOAuthState(userId: string, tenantId: string) {
  const nonce = randomToken(12);
  const state = await new SignJWT({ uid: userId, tid: tenantId, n: nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("amser:ig-state")
    .setExpirationTime("10m")
    .sign(secret());
  return { state, nonce };
}

export async function verifyOAuthState(state: string) {
  try {
    const { payload } = await jwtVerify(state, secret(), { audience: "amser:ig-state", algorithms: ["HS256"] });
    return { uid: String(payload.uid), tid: String(payload.tid), nonce: String(payload.n) };
  } catch {
    return null;
  }
}

export async function connectInstagram(tenantId: string, userId: string, code: string) {
  const provider = instagramProvider();
  if (!provider) throw Errors.policy("Integração com o Instagram indisponível");
  const { accessToken, expiresAt } = await provider.exchangeCode(code, redirectUri());
  const profile = await provider.profile(accessToken);
  const data = { igUserId: profile.userId, username: profile.username, encryptedToken: encryptJson({ accessToken }), tokenExpiresAt: expiresAt };
  await prisma.instagramConnection.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: { ...data, connectedAt: new Date(), refreshedAt: null },
  });
  await prisma.tenant.update({ where: { id: tenantId }, data: { instagramHandle: profile.username } });
  await audit({ tenantId, actorId: userId, action: "instagram.connect", resource: `tenant:${tenantId}`, meta: { username: profile.username } });
}

async function tokenFor(tenantId: string) {
  const conn = await tenantDb(tenantId).instagramConnection.findFirst({});
  if (!conn) throw Errors.policy("Conecte o Instagram primeiro");
  if (conn.tokenExpiresAt < new Date()) throw Errors.policy("A conexão com o Instagram expirou. Conecte novamente.");
  return { conn, accessToken: decryptJson<{ accessToken: string }>(conn.encryptedToken).accessToken };
}

export async function listInstagramMedia(tenantId: string, after?: string | null): Promise<{ items: IgMedia[]; after: string | null; username: string }> {
  const provider = instagramProvider();
  if (!provider) throw Errors.policy("Integração com o Instagram indisponível");
  const { conn, accessToken } = await tokenFor(tenantId);
  const r = await provider.listMedia(accessToken, after);
  return { ...r, username: conn.username };
}

/**
 * Importa posts escolhidos pelo dono. A autorização OAuth da própria conta é a
 * confirmação de direitos. Vídeos não são importados (usa só imagens).
 */
export async function importInstagramMedia(tenantId: string, userId: string, mediaIds: string[]) {
  const provider = instagramProvider();
  if (!provider) throw Errors.policy("Integração com o Instagram indisponível");
  const ids = [...new Set(mediaIds)].slice(0, MAX_IMPORT);
  if (!ids.length) throw Errors.validation("Selecione ao menos uma foto");
  const { conn, accessToken } = await tokenFor(tenantId);
  let imported = 0;
  const failures: string[] = [];
  for (const id of ids) {
    try {
      const m = await provider.getMedia(accessToken, id); // re-busca: a URL da mídia pode ter mudado
      if (m.type === "VIDEO" || !m.mediaUrl) throw new Error("não é imagem");
      const data = await provider.download(m.mediaUrl);
      await uploadTenantImage(tenantId, { data, size: data.length }, { kind: "photo", rightsConfirmed: true, confirmedBy: `instagram:${conn.username}` });
      imported++;
    } catch (err) {
      failures.push(id);
      console.error("[instagram] falha ao importar", id, err instanceof Error ? err.message : err);
    }
  }
  await audit({ tenantId, actorId: userId, action: "instagram.import", resource: `tenant:${tenantId}`, meta: { imported, failed: failures.length } });
  return { imported, failed: failures.length };
}

export async function disconnectInstagram(tenantId: string, userId: string) {
  await tenantDb(tenantId).instagramConnection.deleteMany({});
  await audit({ tenantId, actorId: userId, action: "instagram.disconnect", resource: `tenant:${tenantId}` });
}

/** Renova tokens com menos de 10 dias de validade (exige token com 24h+). */
export async function refreshInstagramTokens(now = new Date()): Promise<number> {
  const provider = instagramProvider();
  if (!provider) return 0;
  const soon = new Date(now.getTime() + 10 * 86400_000);
  const dayAgo = new Date(now.getTime() - 86400_000);
  const list = await prisma.instagramConnection.findMany({
    where: { tokenExpiresAt: { lt: soon, gt: now }, OR: [{ refreshedAt: null, connectedAt: { lt: dayAgo } }, { refreshedAt: { lt: dayAgo } }] },
    take: 50,
  });
  let ok = 0;
  for (const c of list) {
    try {
      const { accessToken } = decryptJson<{ accessToken: string }>(c.encryptedToken);
      const r = await provider.refresh(accessToken);
      await prisma.instagramConnection.update({
        where: { id: c.id },
        data: { encryptedToken: encryptJson({ accessToken: r.accessToken }), tokenExpiresAt: r.expiresAt, refreshedAt: now },
      });
      ok++;
    } catch (err) {
      console.error("[instagram] falha ao renovar token", c.tenantId, err instanceof Error ? err.message : err);
    }
  }
  return ok;
}
