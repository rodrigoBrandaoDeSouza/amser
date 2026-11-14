/**
 * Normaliza o que o dono digitou no campo Instagram para o @ puro.
 * Aceita "@perfil", "perfil", "instagram.com/perfil", "https://www.instagram.com/perfil/?hl=pt".
 * Retorna null se não sobrar um nome válido (letras, números, "." e "_", até 30).
 */
export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^https?:\/\//i, "").replace(/^(www\.|m\.)?instagram\.com\//i, "");
  s = s.split(/[/?#]/)[0].replace(/^@+/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
}
