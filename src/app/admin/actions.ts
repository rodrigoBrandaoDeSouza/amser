"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSuperadmin } from "@/lib/auth/session";
import { runAction, str } from "@/lib/actions";
import { AppError, Errors } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { createTenant, convertProspect, createOwnerUser, seedExampleCatalog, uploadTenantImage, PREVIEW_DAYS } from "@/lib/tenants";
import { analyzeBranding, publishBranding } from "@/lib/branding/service";
import { randomToken } from "@/lib/crypto";

async function uploadFiles(tenantId: string, fd: FormData, rights: boolean, by: string) {
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    await uploadTenantImage(tenantId, { data: Buffer.from(await logo.arrayBuffer()), size: logo.size }, { kind: "logo", rightsConfirmed: rights, confirmedBy: by });
  }
  for (const f of fd.getAll("photos")) {
    if (f instanceof File && f.size > 0) {
      await uploadTenantImage(tenantId, { data: Buffer.from(await f.arrayBuffer()), size: f.size }, { kind: "photo", rightsConfirmed: rights, confirmedBy: by });
    }
  }
}

/** Prévia para prospect (§4.1): fotos → IA → página pronta em minutos. */
export async function createProspectAction(fd: FormData) {
  const admin = await requireSuperadmin();
  let tenantId: string | null = null;
  let error: string | null = null;
  const started = Date.now();
  try {
    const rights = fd.get("rights") === "on";
    if (!rights) throw Errors.validation("Confirme que o prospect enviou ou autorizou as imagens");
    const tenant = await createTenant({
      name: str(fd, "name"),
      segment: str(fd, "segment") || "salao",
      status: "prospect",
      instagramHandle: str(fd, "instagram") || null,
      actorId: admin.id,
    });
    tenantId = tenant.id;
    await uploadFiles(tenant.id, fd, rights, `superadmin:${admin.id}`);
    await seedExampleCatalog(tenant.id, tenant.segment);
    await analyzeBranding(tenant.id, { preferences: str(fd, "preferences") || null, actorId: admin.id });
  } catch (e) {
    error = e instanceof AppError ? e.message : "Falha ao gerar a prévia";
    if (!(e instanceof AppError)) console.error("[prospect]", e);
  }
  if (!tenantId) redirect(`/admin/prospects/novo?erro=${encodeURIComponent(error ?? "Erro")}`);
  const secs = Math.round((Date.now() - started) / 1000);
  redirect(`/admin/empresas/${tenantId}?${error ? `erro=${encodeURIComponent(error)}` : `ok=${encodeURIComponent(`Prévia gerada em ${secs}s`)}`}`);
}

export async function createTenantAction(fd: FormData) {
  const admin = await requireSuperadmin();
  let id: string | null = null;
  let error: string | null = null;
  try {
    const email = str(fd, "ownerEmail").toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw Errors.validation("Já existe um usuário com esse e-mail");
    if (str(fd, "ownerPassword").length < 10) throw Errors.validation("Senha precisa ter ao menos 10 caracteres");
    const tenant = await createTenant({
      name: str(fd, "name"),
      segment: str(fd, "segment") || "salao",
      slug: str(fd, "slug") || undefined,
      status: "onboarding",
      planId: str(fd, "planId") || null,
      phone: str(fd, "phone") || null,
      instagramHandle: str(fd, "instagram") || null,
      actorId: admin.id,
    });
    id = tenant.id;
    await createOwnerUser(tenant.id, { name: str(fd, "ownerName"), email, password: str(fd, "ownerPassword") });
  } catch (e) {
    error = e instanceof AppError ? e.message : "Falha ao criar empresa";
    if (!(e instanceof AppError)) console.error("[tenant]", e);
  }
  if (!id) redirect(`/admin/empresas/nova?erro=${encodeURIComponent(error ?? "Erro")}`);
  redirect(`/admin/empresas/${id}?${error ? `erro=${encodeURIComponent(error)}` : "ok=Empresa+criada"}`);
}

export async function convertProspectAction(tenantId: string, fd: FormData) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    await convertProspect(tenantId, { name: str(fd, "ownerName"), email: str(fd, "ownerEmail"), password: str(fd, "ownerPassword") }, admin.id);
    return "Prévia convertida. O dono já pode entrar no painel.";
  });
}

export async function setTenantStatusAction(tenantId: string, status: "active" | "suspended" | "onboarding") {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t || t.status === "prospect" || t.status === "deleted") throw Errors.policy("Status não pode ser alterado");
    await prisma.tenant.update({ where: { id: tenantId }, data: { status, suspendedReason: status === "suspended" ? "admin" : null, statusBeforeSuspension: null } });
    await audit({ tenantId, actorId: admin.id, action: `tenant.status.${status}`, resource: `tenant:${tenantId}` });
    return "Status atualizado";
  });
}

export async function extendPreviewAction(tenantId: string) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    await prisma.tenant.updateMany({
      where: { id: tenantId, status: "prospect" },
      data: { previewExpiresAt: new Date(Date.now() + PREVIEW_DAYS * 86400_000), previewToken: randomToken(24) },
    });
    await audit({ tenantId, actorId: admin.id, action: "prospect.extend", resource: `tenant:${tenantId}` });
    return `Prévia renovada por ${PREVIEW_DAYS} dias (link novo)`;
  });
}

export async function deleteProspectAction(tenantId: string) {
  const admin = await requireSuperadmin();
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (t?.status === "prospect") {
    await prisma.tenant.update({ where: { id: tenantId }, data: { previewExpiresAt: new Date(0) } });
    const { purgeExpiredProspects } = await import("@/lib/jobs");
    await purgeExpiredProspects();
    await audit({ actorId: admin.id, action: "prospect.delete", resource: `tenant:${tenantId}` });
  }
  redirect("/admin?ok=Prévia+apagada");
}

export async function reanalyzeAction(tenantId: string, fd: FormData) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    if (fd.getAll("photos").some((f) => f instanceof File && f.size > 0) || (fd.get("logo") instanceof File && (fd.get("logo") as File).size > 0)) {
      await uploadFiles(tenantId, fd, fd.get("rights") === "on", `superadmin:${admin.id}`);
    }
    await analyzeBranding(tenantId, { preferences: str(fd, "preferences") || null, actorId: admin.id });
    return "Novo rascunho de tema gerado";
  });
}

export async function publishBrandingAdminAction(tenantId: string, brandingId: string) {
  await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    await publishBranding(tenantId, brandingId);
    return "Tema publicado";
  });
}

export async function changePlanAction(tenantId: string, fd: FormData) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const planId = str(fd, "planId");
    if (!(await prisma.plan.findUnique({ where: { id: planId } }))) throw Errors.validation("Plano inválido");
    const { changePlan } = await import("@/lib/billing/service");
    await changePlan(tenantId, planId, admin.id);
    return "Plano alterado (vale a partir da próxima fatura)";
  });
}

// ---------------------------------------------------------------- suporte, exclusão e flags

export async function enterSupportAction(tenantId: string) {
  const admin = await requireSuperadmin();
  let error: string | null = null;
  try {
    const { assertSupportAllowed } = await import("@/lib/ops");
    await assertSupportAllowed(tenantId);
  } catch (e) {
    error = e instanceof AppError ? e.message : "Erro";
  }
  if (error) redirect(`/admin/empresas/${tenantId}?erro=${encodeURIComponent(error)}`);
  const { createSession } = await import("@/lib/auth/session");
  await createSession(admin, { supportTenantId: tenantId });
  await audit({ tenantId, actorId: admin.id, action: "support.enter", resource: `tenant:${tenantId}` });
  redirect("/painel");
}

export async function scheduleDeletionAction(tenantId: string) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { scheduleDeletion } = await import("@/lib/ops");
    const at = await scheduleDeletion(tenantId, admin.id);
    return `Exclusão programada para ${at.toLocaleDateString("pt-BR")}. A página foi suspensa.`;
  });
}

export async function cancelDeletionAction(tenantId: string) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { cancelDeletion } = await import("@/lib/ops");
    await cancelDeletion(tenantId, admin.id);
    return "Exclusão cancelada";
  });
}

export async function setFlagAction(key: string, scope: string, value: "on" | "off" | "default") {
  const admin = await requireSuperadmin();
  const back = scope === "global" ? "/admin/flags" : `/admin/empresas/${scope}`;
  await runAction(back, async () => {
    const { FLAGS, setFlag } = await import("@/lib/flags");
    if (!(key in FLAGS)) throw Errors.validation("Flag desconhecida");
    if (scope !== "global" && !(await prisma.tenant.findUnique({ where: { id: scope } }))) throw Errors.notFound("Empresa");
    await setFlag(key as keyof typeof FLAGS, value === "default" ? null : value === "on", scope);
    await audit({ tenantId: scope === "global" ? null : scope, actorId: admin.id, action: "flag.set", resource: `flag:${key}`, meta: { scope, value } });
    return "Flag atualizada";
  });
}

// ---------------------------------------------------------------- WhatsApp no onboarding (feito pela equipe)

export async function adminConnectWhatsappAction(tenantId: string, fd: FormData) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { saveAndTestConnection } = await import("@/lib/whatsapp/service");
    const r = await saveAndTestConnection(tenantId, admin.id, {
      phoneNumberId: str(fd, "phoneNumberId"),
      wabaId: str(fd, "wabaId"),
      accessToken: str(fd, "accessToken") || null,
    });
    const name = r.info?.verifiedName ? ` (${r.info.verifiedName} · ${r.info.displayPhoneNumber})` : "";
    return r.subscribeWarning ? `Número validado${name}; aviso ao inscrever o app: ${r.subscribeWarning}` : `WhatsApp conectado${name}`;
  });
}

export async function adminProvisionTemplatesAction(tenantId: string) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { provisionTemplates } = await import("@/lib/whatsapp/service");
    const r = await provisionTemplates(tenantId, admin.id);
    const errors = r.filter((x) => x.error);
    return errors.length ? `${r.length - errors.length} enviados; ${errors.length} com erro: ${errors.map((e) => e.name).join(", ")}` : `${r.length} templates enviados para análise da Meta`;
  });
}

export async function adminSyncTemplatesAction(tenantId: string) {
  await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { syncTemplates } = await import("@/lib/whatsapp/service");
    return `Status de ${await syncTemplates(tenantId)} template(s) atualizado`;
  });
}

export async function adminTestWhatsappAction(tenantId: string, fd: FormData) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { sendTestMessage } = await import("@/lib/whatsapp/service");
    await sendTestMessage(tenantId, admin.id, str(fd, "testPhone"));
    return "Mensagem de teste (hello_world) enviada";
  });
}

export async function manualPaymentAction(tenantId: string) {
  const admin = await requireSuperadmin();
  await runAction(`/admin/empresas/${tenantId}`, async () => {
    const { registerManualPayment } = await import("@/lib/billing/service");
    const until = await registerManualPayment(tenantId, admin.id);
    return `Pagamento registrado. Assinatura ativa até ${until.toLocaleDateString("pt-BR")}.`;
  });
}
