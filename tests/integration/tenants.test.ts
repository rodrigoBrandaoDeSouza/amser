import { beforeEach, describe, expect, it } from "vitest";
import { demoPng } from "@/lib/demo-image";
import { prisma, tenantDb } from "@/lib/db";
import { createTenant, convertProspect, seedExampleCatalog, uploadTenantImage } from "@/lib/tenants";
import { analyzeBranding, publishBranding, restoreBranding, publishedTheme } from "@/lib/branding/service";
import { purgeExpiredProspects } from "@/lib/jobs";
import { getPublicCatalog, getPublicTenant } from "@/lib/public";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const PNG = demoPng([200, 100, 150], [20, 20, 20], 64);

async function admin() {
  return prisma.user.create({ data: { name: "Admin", email: `admin${Math.random()}@x.dev`, passwordHash: "x", role: "superadmin" } });
}

describe("prévia para prospect (§4.1)", () => {
  it("fotos → IA → prévia com exemplos; não aparece no slug público", async () => {
    const a = await admin();
    const t = await createTenant({ name: "Studio Bia", segment: "nail", status: "prospect", actorId: a.id });
    expect(t.previewToken).toBeTruthy();
    expect(t.previewExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    await expect(uploadTenantImage(t.id, { data: PNG, size: PNG.length }, { kind: "photo", rightsConfirmed: false, confirmedBy: "a" })).rejects.toMatchObject({
      code: "validation",
    });
    await uploadTenantImage(t.id, { data: PNG, size: PNG.length }, { kind: "logo", rightsConfirmed: true, confirmedBy: "a" });
    await uploadTenantImage(t.id, { data: PNG, size: PNG.length }, { kind: "photo", rightsConfirmed: true, confirmedBy: "a" });
    await expect(
      uploadTenantImage(t.id, { data: Buffer.from("GIF89a fake"), size: 11 }, { kind: "photo", rightsConfirmed: true, confirmedBy: "a" }),
    ).rejects.toMatchObject({ code: "validation" });

    await seedExampleCatalog(t.id, "nail");
    const draft = await analyzeBranding(t.id);
    expect(draft.status).toBe("draft");
    expect(await getPublicTenant(t.slug)).toBeNull(); // prévia nunca no slug público
    expect((await getPublicCatalog(t.id)).every((s) => !s.description?.startsWith("[exemplo]"))).toBe(true);
  });

  it("conversão mantém tema e desativa serviços de exemplo", async () => {
    const a = await admin();
    const t = await createTenant({ name: "Studio Caio", segment: "barbearia", status: "prospect", actorId: a.id });
    await seedExampleCatalog(t.id, "barbearia");
    await convertProspect(t.id, { name: "Caio", email: "caio@x.dev", password: "senha-forte-123" }, a.id);
    const after = await prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe("onboarding");
    expect(after.previewToken).toBeNull();
    expect(await tenantDb(t.id).service.count({ where: { active: true } })).toBe(0);
    expect(await prisma.user.count({ where: { tenantId: t.id, role: "owner" } })).toBe(1);
  });

  it("prévia expirada é apagada com mídias (LGPD)", async () => {
    const a = await admin();
    const t = await createTenant({ name: "Studio Duda", segment: "nail", status: "prospect", actorId: a.id });
    await uploadTenantImage(t.id, { data: PNG, size: PNG.length }, { kind: "photo", rightsConfirmed: true, confirmedBy: "a" });
    await prisma.tenant.update({ where: { id: t.id }, data: { previewExpiresAt: new Date(Date.now() - 1000) } });
    expect(await purgeExpiredProspects()).toBe(1);
    expect(await prisma.tenant.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.tenantMedia.count()).toBe(0);
  });
});

describe("versionamento do tema (§6)", () => {
  it("publica, arquiva a anterior e restaura como rascunho", async () => {
    const a = await admin();
    const t = await createTenant({ name: "Salão Eva", segment: "salao", status: "onboarding", actorId: a.id });
    await uploadTenantImage(t.id, { data: PNG, size: PNG.length }, { kind: "photo", rightsConfirmed: true, confirmedBy: "a" });
    const v1 = await analyzeBranding(t.id);
    await publishBranding(t.id, v1.id);
    const v2 = await analyzeBranding(t.id);
    await publishBranding(t.id, v2.id);
    const all = await tenantDb(t.id).tenantBranding.findMany({ orderBy: { version: "asc" } });
    expect(all.map((b) => b.status)).toEqual(["archived", "published"]);
    const v3 = await restoreBranding(t.id, v1.id);
    expect(v3.version).toBe(3);
    expect(v3.status).toBe("draft");
    expect((await publishedTheme(t.id, t.name)).copy.headline).toBe("Salão Eva");
  });

  it("não publica versão de outro tenant", async () => {
    const a = await admin();
    const t1 = await createTenant({ name: "Loja Um", segment: "salao", status: "onboarding", actorId: a.id });
    const t2 = await createTenant({ name: "Loja Dois", segment: "salao", status: "onboarding", actorId: a.id });
    await uploadTenantImage(t1.id, { data: PNG, size: PNG.length }, { kind: "photo", rightsConfirmed: true, confirmedBy: "a" });
    const v = await analyzeBranding(t1.id);
    await expect(publishBranding(t2.id, v.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("tenantDb", () => {
  it("recusa modelos não tenant-scoped", async () => {
    const db = tenantDb("qualquer") as unknown as { user: { findMany: () => Promise<unknown> } };
    await expect(db.user.findMany()).rejects.toThrow(/não é tenant-scoped/);
  });
});
