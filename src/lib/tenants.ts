import type { Prisma } from "@prisma/client";
import { prisma, tenantDb, isUniqueViolation } from "./db";
import { Errors } from "./errors";
import { isValidSlug, slugify } from "./format";
import { randomToken } from "./crypto";
import { audit } from "./audit";
import { hashPassword } from "./auth/password";
import { MAX_UPLOAD_BYTES, sniffImage, storage } from "./storage";

export const PREVIEW_DAYS = 14;

export async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base) || "empresa";
  if (!isValidSlug(slug)) slug = `${slug}-amser`.replace(/^-/, "");
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    if (!(await prisma.tenant.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  return `${slug}-${randomToken(3).toLowerCase()}`;
}

/** Cria tenant com unidade padrão (MVP usa uma unidade). */
export async function createTenant(input: {
  name: string;
  segment: string;
  slug?: string;
  status: "prospect" | "onboarding";
  planId?: string | null;
  phone?: string | null;
  instagramHandle?: string | null;
  actorId: string;
}) {
  const name = input.name.trim();
  if (name.length < 2) throw Errors.validation("Nome obrigatório");
  const slug = input.slug ? input.slug.trim().toLowerCase() : await uniqueSlug(name);
  if (!isValidSlug(slug)) throw Errors.validation("Slug inválido (use letras minúsculas, números e hífen)");

  const isProspect = input.status === "prospect";
  try {
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        segment: input.segment,
        status: input.status,
        planId: input.planId ?? null,
        phone: input.phone ?? null,
        instagramHandle: input.instagramHandle?.replace(/^@/, "") || null,
        previewToken: isProspect ? randomToken(24) : null,
        previewExpiresAt: isProspect ? new Date(Date.now() + PREVIEW_DAYS * 86400_000) : null,
        units: { create: { name: "Principal" } },
      },
    });
    await audit({ tenantId: tenant.id, actorId: input.actorId, action: `tenant.create.${input.status}`, resource: `tenant:${tenant.id}` });
    return tenant;
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.validation("Esse endereço (slug) já está em uso");
    throw err;
  }
}

/** Converte prévia em empresa em onboarding, mantendo tema e mídias (§4.1). */
export async function convertProspect(tenantId: string, owner: { name: string; email: string; password: string }, actorId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.status !== "prospect") throw Errors.notFound("Prévia");
  const email = owner.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.validation("E-mail inválido");
  if (owner.password.length < 10) throw Errors.validation("Senha precisa ter ao menos 10 caracteres");
  const passwordHash = await hashPassword(owner.password);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { status: "onboarding", previewToken: null, previewExpiresAt: null },
      });
      // Exemplos da prévia viram inativos: o dono cadastra os reais.
      await tx.service.updateMany({ where: { tenantId, description: { startsWith: "[exemplo]" } }, data: { active: false } });
      await tx.user.create({ data: { tenantId, name: owner.name.trim(), email, passwordHash, role: "owner" } });
      await audit({ tenantId, actorId, action: "prospect.convert", resource: `tenant:${tenantId}` }, tx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.validation("Já existe um usuário com esse e-mail");
    throw err;
  }
}

export async function createOwnerUser(tenantId: string, owner: { name: string; email: string; password: string }, role: "owner" | "staff" = "owner") {
  const email = owner.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.validation("E-mail inválido");
  if (owner.password.length < 10) throw Errors.validation("Senha precisa ter ao menos 10 caracteres");
  try {
    return await prisma.user.create({
      data: { tenantId, name: owner.name.trim(), email, passwordHash: await hashPassword(owner.password), role },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.validation("Já existe um usuário com esse e-mail");
    throw err;
  }
}

/** Upload de imagem com confirmação obrigatória de direitos (§5, §4.1). */
export async function uploadTenantImage(
  tenantId: string,
  file: { data: Buffer; size: number },
  opts: { kind: "logo" | "photo"; rightsConfirmed: boolean; confirmedBy: string },
) {
  if (!opts.rightsConfirmed) throw Errors.validation("Confirme que o negócio enviou ou autorizou o uso das imagens");
  if (file.size > MAX_UPLOAD_BYTES) throw Errors.validation("Imagem maior que 5 MB");
  const sniffed = sniffImage(file.data);
  if (!sniffed) throw Errors.validation("Formato não suportado (use JPG, PNG ou WebP)");
  const db = tenantDb(tenantId);
  const count = await db.tenantMedia.count();
  if (count >= 20) throw Errors.validation("Limite de 20 imagens por empresa");
  const key = await storage().put(tenantId, file.data, sniffed.ext);
  return db.tenantMedia.create({
    data: {
      tenantId,
      storageKey: key,
      kind: opts.kind,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
      rightsConfirmed: true,
      rightsConfirmedBy: opts.confirmedBy,
    } satisfies Prisma.TenantMediaUncheckedCreateInput,
  });
}

export async function deleteTenantImage(tenantId: string, mediaId: string) {
  const db = tenantDb(tenantId);
  const m = await db.tenantMedia.findFirst({ where: { id: mediaId } });
  if (!m) throw Errors.notFound("Imagem");
  await db.tenantMedia.delete({ where: { id: m.id } });
  await storage().delete(m.storageKey).catch(() => undefined);
}

/** Serviços de exemplo para a prévia, claramente marcados (nunca preços "reais"). */
export async function seedExampleCatalog(tenantId: string, segment: string) {
  const db = tenantDb(tenantId);
  const unit = await db.unit.findFirstOrThrow({});
  const examples: Record<string, [string, number, number][]> = {
    barbearia: [["Corte", 40, 4500], ["Barba", 30, 3500], ["Corte + barba", 60, 7000]],
    nail: [["Manicure", 45, 3500], ["Alongamento em gel", 120, 15000], ["Esmaltação em gel", 60, 6000]],
    sobrancelha: [["Design de sobrancelha", 30, 4500], ["Design com henna", 45, 6000], ["Brow lamination", 60, 12000]],
    salao: [["Corte feminino", 60, 9000], ["Escova", 45, 6000], ["Coloração", 120, 20000]],
  };
  const key = Object.keys(examples).find((k) => segment.toLowerCase().includes(k)) ?? "salao";
  const pro = await db.professional.create({ data: { tenantId, unitId: unit.id, displayName: "Profissional (exemplo)" } });
  for (const [name, minutes, price] of examples[key]) {
    const svc = await db.service.create({
      data: { tenantId, name, description: "[exemplo] Serviço ilustrativo da prévia", durationMinutes: minutes, priceCents: price },
    });
    await db.serviceProfessional.create({ data: { tenantId, serviceId: svc.id, professionalId: pro.id } });
  }
}
