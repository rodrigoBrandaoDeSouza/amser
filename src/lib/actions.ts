import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "./errors";

/**
 * Executa uma server action e volta para `path` com ?ok= ou ?erro=.
 * O redirect fica fora do try (redirect() lança internamente).
 */
export async function runAction(path: string, fn: () => Promise<string | void>): Promise<never> {
  let ok: string | undefined;
  let erro: string | undefined;
  try {
    ok = (await fn()) || "Salvo";
  } catch (e) {
    if (e instanceof AppError) erro = e.message;
    else {
      console.error("[action]", e);
      erro = "Algo deu errado. Tente novamente.";
    }
  }
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${erro ? "erro" : "ok"}=${encodeURIComponent(erro ?? ok!)}`);
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function int(fd: FormData, key: string, fallback = 0): number {
  const n = Number.parseInt(str(fd, key), 10);
  return Number.isFinite(n) ? n : fallback;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function flashParams(sp: SearchParams) {
  const p = await sp;
  const one = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  return { ok: one("ok"), erro: one("erro"), get: one };
}
