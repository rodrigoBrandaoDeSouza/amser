/**
 * Rate limiting em memória (janela deslizante simples por chave).
 * Adequado para uma instância (arquitetura aprovada: app única no Railway).
 * Se escalar horizontalmente, trocar por tabela no Postgres — ver docs/tasks.md.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return true;
}

/**
 * IP do cliente para rate limit. O X-Forwarded-For é uma lista em que o
 * PRIMEIRO valor pode ser forjado pelo próprio cliente; o proxy confiável
 * (Railway) acrescenta o IP real no FIM. Por isso usamos o valor que está
 * TRUST_PROXY_HOPS posições a partir do fim (padrão 1).
 */
export function clientIp(headers: Headers): string {
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1);
  const list = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length) return list[Math.max(0, list.length - hops)];
  return headers.get("x-real-ip") || "local";
}
