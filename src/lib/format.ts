/** Dinheiro em centavos (inteiros) para evitar erro de ponto flutuante. */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** "49,90" | "49.90" | "49" -> 4990 */
export function parseBRL(input: string): number | null {
  const clean = input.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/**
 * Normaliza telefone brasileiro para E.164. Aceita "(11) 98888-7777",
 * "11988887777", "+55 11 98888-7777". Retorna null se inválido.
 */
export function normalizePhoneBR(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let national = digits;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) return null;
  const ddd = Number(national.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (national.length === 11 && national[2] !== "9") return null;
  return `+55${national}`;
}

export function maskPhone(e164: string): string {
  const n = e164.replace("+55", "");
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return e164;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const RESERVED_SLUGS = new Set([
  "admin", "api", "painel", "login", "logout", "preview", "media", "public", "static",
  "_next", "favicon.ico", "robots.txt", "sitemap.xml", "agendamento", "a", "amser", "marca-preview", "d", "w", "cadastro", "planos",
]);

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}
