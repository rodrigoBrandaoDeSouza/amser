import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../env";

/**
 * Armazenamento de mídia (§15). Dev: disco local. Produção: object storage
 * externo (S3/R2) — NÃO usar o disco efêmero do Railway. Ver docs/tasks.md.
 */
export interface Storage {
  put(tenantId: string, data: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function localStorage(): Storage {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const resolveKey = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("chave inválida");
    return full;
  };
  return {
    async put(tenantId, data, ext) {
      const key = `${tenantId}/${crypto.randomUUID()}.${ext}`;
      const full = resolveKey(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
      return key;
    },
    get: (key) => fs.readFile(resolveKey(key)),
    async delete(key) {
      await fs.rm(resolveKey(key), { force: true });
    },
  };
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) instance = localStorage();
  return instance;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Detecta o tipo real pelo conteúdo (não confia no mime enviado). */
export function sniffImage(buf: Buffer): { mime: "image/jpeg" | "image/png" | "image/webp"; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}
