import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

/**
 * Armazenamento de mídia (§15). Dev: disco local. Produção: object storage
 * compatível com S3 — AWS S3 ou Cloudflare R2 (mesmo provider; muda só o
 * endpoint). NUNCA usar o disco efêmero do Railway em produção.
 */
export interface Storage {
  name: string;
  put(tenantId: string, data: Buffer, ext: string, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function newKey(tenantId: string, ext: string) {
  return `${tenantId}/${crypto.randomUUID()}.${ext}`;
}

function localStorage(): Storage {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const resolveKey = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("chave inválida");
    return full;
  };
  return {
    name: "local",
    async put(tenantId, data, ext) {
      const key = newKey(tenantId, ext);
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

function s3Storage(): Storage {
  const e = env();
  if (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) throw new Error("Configure S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY");
  const client = new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT || undefined, // R2: https://<account>.r2.cloudflarestorage.com
    forcePathStyle: !!e.S3_ENDPOINT,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  const prefix = e.S3_PREFIX ? `${e.S3_PREFIX.replace(/\/$/, "")}/` : "";
  return {
    name: "s3",
    async put(tenantId, data, ext, contentType) {
      const key = newKey(tenantId, ext);
      await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: prefix + key, Body: data, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
      return key;
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: prefix + key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: prefix + key }));
    },
  };
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) instance = env().STORAGE_PROVIDER === "s3" ? s3Storage() : localStorage();
  return instance;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // antes da otimização (fotos de celular)
export const MAX_IMAGE_SIDE = 1600;

/** Detecta o tipo real pelo conteúdo (não confia no mime enviado). */
export function sniffImage(buf: Buffer): { mime: "image/jpeg" | "image/png" | "image/webp"; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/**
 * Otimiza a imagem antes de guardar: corrige a rotação (EXIF), limita o maior
 * lado a 1600 px, remove metadados (inclusive localização GPS — LGPD) e
 * converte para WebP (logos com transparência continuam PNG).
 */
export async function optimizeImage(data: Buffer, kind: "logo" | "photo"): Promise<{ data: Buffer; mime: "image/webp" | "image/png"; ext: string }> {
  const sharp = (await import("sharp")).default;
  const img = sharp(data, { failOn: "error", limitInputPixels: 50_000_000 }).rotate();
  const meta = await img.metadata();
  const resized = img.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
  if (kind === "logo" && meta.hasAlpha) {
    return { data: await resized.png({ compressionLevel: 9 }).toBuffer(), mime: "image/png", ext: "png" };
  }
  return { data: await resized.webp({ quality: 82 }).toBuffer(), mime: "image/webp", ext: "webp" };
}
