import { env } from "../env";
import { colorFromString, demoPng } from "../demo-image";

/**
 * Instagram API com Instagram Login (Business Login for Instagram) — Fase 2.
 * Endpoints conferidos na documentação oficial da Meta em 2026-11-13:
 *  - autorização:  https://www.instagram.com/oauth/authorize  (scope instagram_business_basic)
 *  - token curto:  POST https://api.instagram.com/oauth/access_token  (resposta em data[])
 *  - token longo:  GET  https://graph.instagram.com/access_token?grant_type=ig_exchange_token (60 dias)
 *  - renovar:      GET  https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *  - mídia:        GET  https://graph.instagram.com/{v}/me/media  e  /{media-id}?fields=…
 * Requisitos: conta profissional (Business/Creator); app do tipo Business;
 * Advanced Access + App Review para atender contas de terceiros.
 */
export interface IgMedia {
  id: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export interface InstagramProvider {
  name: string;
  authorizeUrl(state: string, redirectUri: string): string;
  /** code → token longo (60 dias). */
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; expiresAt: Date }>;
  refresh(accessToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
  profile(accessToken: string): Promise<{ userId: string; username: string }>;
  listMedia(accessToken: string, after?: string | null): Promise<{ items: IgMedia[]; after: string | null }>;
  getMedia(accessToken: string, id: string): Promise<IgMedia>;
  download(url: string): Promise<Buffer>;
}

const MAX_DOWNLOAD = 8 * 1024 * 1024;
const MEDIA_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp";

/** Evita SSRF: só baixa de CDNs da Meta, via HTTPS. */
export function isAllowedMediaHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname.endsWith(".cdninstagram.com") || u.hostname.endsWith(".fbcdn.net"));
  } catch {
    return false;
  }
}

function toMedia(m: Record<string, unknown>): IgMedia {
  return {
    id: String(m.id),
    type: (m.media_type as IgMedia["type"]) ?? "IMAGE",
    mediaUrl: (m.media_url as string) ?? null,
    thumbnailUrl: (m.thumbnail_url as string) ?? null,
    permalink: (m.permalink as string) ?? null,
    timestamp: (m.timestamp as string) ?? null,
  };
}

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string })?.message ?? (json.error_message as string) ?? `HTTP ${res.status}`;
    throw new Error(`Instagram: ${err}`);
  }
  return json;
}

export const metaInstagramProvider: InstagramProvider = {
  name: "meta",
  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      client_id: env().INSTAGRAM_APP_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic",
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${q}`;
  },
  async exchangeCode(code, redirectUri) {
    const form = new FormData();
    form.set("client_id", env().INSTAGRAM_APP_ID);
    form.set("client_secret", env().INSTAGRAM_APP_SECRET);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);
    form.set("code", code.replace(/#_$/, ""));
    const short = await getJson("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    // A doc mostra a resposta dentro de data[]; aceita também o formato plano.
    const row = (Array.isArray(short.data) ? short.data[0] : short) as { access_token?: string };
    if (!row?.access_token) throw new Error("Instagram: token ausente");
    const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: env().INSTAGRAM_APP_SECRET, access_token: row.access_token });
    const long = await getJson(`https://graph.instagram.com/access_token?${q}`);
    return { accessToken: String(long.access_token), expiresAt: new Date(Date.now() + Number(long.expires_in ?? 5184000) * 1000) };
  },
  async refresh(accessToken) {
    const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken });
    const r = await getJson(`https://graph.instagram.com/refresh_access_token?${q}`);
    return { accessToken: String(r.access_token), expiresAt: new Date(Date.now() + Number(r.expires_in ?? 5184000) * 1000) };
  },
  async profile(accessToken) {
    const v = env().INSTAGRAM_GRAPH_VERSION;
    const r = await getJson(`https://graph.instagram.com/${v}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`);
    return { userId: String(r.user_id ?? r.id), username: String(r.username) };
  },
  async listMedia(accessToken, after) {
    const v = env().INSTAGRAM_GRAPH_VERSION;
    const q = new URLSearchParams({ fields: MEDIA_FIELDS, limit: "24", access_token: accessToken, ...(after ? { after } : {}) });
    const r = await getJson(`https://graph.instagram.com/${v}/me/media?${q}`);
    const data = (r.data as Record<string, unknown>[]) ?? [];
    // A doc indica que a aresta pode devolver só IDs: completa item a item quando faltar o tipo.
    const items = await Promise.all(data.map((m) => (m.media_type ? toMedia(m) : this.getMedia(accessToken, String(m.id)))));
    const paging = r.paging as { cursors?: { after?: string }; next?: string } | undefined;
    return { items, after: paging?.next ? (paging.cursors?.after ?? null) : null };
  },
  async getMedia(accessToken, id) {
    if (!/^\d{5,30}$/.test(id)) throw new Error("id de mídia inválido");
    const v = env().INSTAGRAM_GRAPH_VERSION;
    return toMedia(await getJson(`https://graph.instagram.com/${v}/${id}?fields=${MEDIA_FIELDS}&access_token=${encodeURIComponent(accessToken)}`));
  },
  async download(url) {
    if (!isAllowedMediaHost(url)) throw new Error("origem de mídia não permitida");
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!res.ok) throw new Error(`download falhou (${res.status})`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_DOWNLOAD) throw new Error("imagem grande demais");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD) throw new Error("imagem grande demais");
    return buf;
  },
};

/** Mock para dev/testes: conta "@studio_demo" com 9 posts gerados. */
export const mockInstagramProvider: InstagramProvider = {
  name: "mock",
  authorizeUrl(state, redirectUri) {
    return `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`;
  },
  async exchangeCode() {
    return { accessToken: "mock-ig-token", expiresAt: new Date(Date.now() + 60 * 86400_000) };
  },
  async refresh() {
    return { accessToken: "mock-ig-token-2", expiresAt: new Date(Date.now() + 60 * 86400_000) };
  },
  async profile() {
    return { userId: "17841400000000000", username: "studio_demo" };
  },
  async listMedia() {
    const items: IgMedia[] = Array.from({ length: 9 }, (_, i) => ({
      id: String(17900000000000 + i),
      type: i === 4 ? "VIDEO" : "IMAGE",
      mediaUrl: `https://scontent.cdninstagram.com/mock/${i}.png`,
      thumbnailUrl: null,
      permalink: `https://www.instagram.com/p/mock${i}/`,
      timestamp: new Date(Date.now() - i * 86400_000).toISOString(),
    }));
    return { items, after: null };
  },
  async getMedia(_t, id) {
    const i = Number(id) - 17900000000000;
    if (!(i >= 0 && i < 9)) throw new Error("mídia não encontrada");
    return { id, type: i === 4 ? "VIDEO" : "IMAGE", mediaUrl: `https://scontent.cdninstagram.com/mock/${i}.png`, thumbnailUrl: null, permalink: null, timestamp: null };
  },
  async download(url) {
    if (!isAllowedMediaHost(url)) throw new Error("origem de mídia não permitida");
    return demoPng(colorFromString(url), colorFromString(url + "x"), 320);
  },
};

export function instagramProvider(): InstagramProvider | null {
  switch (env().INSTAGRAM_PROVIDER) {
    case "meta":
      return env().INSTAGRAM_APP_ID && env().INSTAGRAM_APP_SECRET ? metaInstagramProvider : null;
    case "mock":
      return mockInstagramProvider;
    default:
      return null;
  }
}
