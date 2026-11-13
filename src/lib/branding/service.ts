import type { Prisma } from "@prisma/client";
import { prisma, tenantDb } from "../db";
import { Errors } from "../errors";
import { storage } from "../storage";
import { isEnabled } from "../flags";
import { brandAnalyzer } from "./analyze";
import { defaultTheme, finalizeTheme, normalizeEditedTheme, ThemeSchema, type Theme } from "./theme";

/**
 * Fluxo (§6): materiais autorizados → análise multimodal → JSON validado →
 * rascunho versionado → preview → aprovação humana → publicação.
 */
export async function analyzeBranding(tenantId: string, opts: { preferences?: string | null; actorId?: string | null } = {}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw Errors.notFound("Empresa");
  if (!(await isEnabled("ai_branding", tenantId))) throw Errors.policy("O tema por IA está desativado no momento. Ajuste as cores e textos manualmente.");
  const db = tenantDb(tenantId);
  const media = await db.tenantMedia.findMany({ where: { rightsConfirmed: true }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }], take: 8 });
  if (!media.length) throw Errors.validation("Envie ao menos uma imagem com direitos confirmados");

  const images = await Promise.all(
    media.map(async (m) => ({
      mime: m.mimeType as "image/jpeg" | "image/png" | "image/webp",
      data: await storage().get(m.storageKey),
      isLogo: m.kind === "logo",
    })),
  );
  const analyzer = brandAnalyzer();
  const started = Date.now();
  const ai = await analyzer.analyze({ name: tenant.name, segment: tenant.segment, preferences: opts.preferences, images });
  const theme = finalizeTheme(ai, media.map((m) => m.id));
  return saveDraft(tenantId, theme, {
    analyzer: analyzer.name,
    mediaIds: media.map((m) => m.id),
    durationMs: Date.now() - started,
    actorId: opts.actorId ?? null,
  });
}

export async function saveDraft(tenantId: string, theme: Theme, source: Prisma.InputJsonValue) {
  const db = tenantDb(tenantId);
  const last = await db.tenantBranding.findFirst({ orderBy: { version: "desc" } });
  return db.tenantBranding.create({
    data: {
      tenantId,
      themeJson: ThemeSchema.parse(theme) as unknown as Prisma.InputJsonValue,
      sourceMetadataJson: source,
      version: (last?.version ?? 0) + 1,
      status: "draft",
    },
  });
}

export async function updateDraft(tenantId: string, brandingId: string, theme: Theme) {
  const db = tenantDb(tenantId);
  const draft = await db.tenantBranding.findFirst({ where: { id: brandingId, status: "draft" } });
  if (!draft) throw Errors.notFound("Rascunho");
  const normalized = normalizeEditedTheme(theme);
  return db.tenantBranding.update({ where: { id: draft.id }, data: { themeJson: normalized as unknown as Prisma.InputJsonValue } });
}

/** Publica uma versão (aprovação humana obrigatória — chamada só pelo painel). */
export async function publishBranding(tenantId: string, brandingId: string) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.tenantBranding.findFirst({ where: { id: brandingId, tenantId } });
    if (!target) throw Errors.notFound("Versão");
    await tx.tenantBranding.updateMany({ where: { tenantId, status: "published" }, data: { status: "archived" } });
    await tx.tenantBranding.update({ where: { id: target.id }, data: { status: "published" } });
  });
}

/** Restaura uma versão anterior como novo rascunho. */
export async function restoreBranding(tenantId: string, brandingId: string) {
  const old = await tenantDb(tenantId).tenantBranding.findFirst({ where: { id: brandingId } });
  if (!old) throw Errors.notFound("Versão");
  return saveDraft(tenantId, ThemeSchema.parse(old.themeJson), { restoredFrom: old.version });
}

export async function publishedTheme(tenantId: string, tenantName: string): Promise<Theme> {
  const pub = await tenantDb(tenantId).tenantBranding.findFirst({ where: { status: "published" }, orderBy: { version: "desc" } });
  const parsed = pub ? ThemeSchema.safeParse(pub.themeJson) : null;
  return parsed?.success ? parsed.data : defaultTheme(tenantName);
}

export async function latestTheme(tenantId: string, tenantName: string): Promise<Theme> {
  const last = await tenantDb(tenantId).tenantBranding.findFirst({ orderBy: { version: "desc" } });
  const parsed = last ? ThemeSchema.safeParse(last.themeJson) : null;
  return parsed?.success ? parsed.data : defaultTheme(tenantName);
}
