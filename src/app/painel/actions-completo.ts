"use server";

import { redirect } from "next/navigation";
import { requireTenantUser, currentSession, createSession } from "@/lib/auth/session";
import { runAction, str, int } from "@/lib/actions";
import { Errors } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { STAFF_PERMISSIONS, type StaffPermission } from "@/lib/auth/permissions";
import { anonymizeCustomer, importCustomersCsv, setWhatsappConsent, updateCustomer } from "@/lib/crm";

// ---------------------------------------------------------------- suporte

/** Superadmin sai da empresa que estava gerenciando e volta ao painel de admin. */
export async function endSupportAction() {
  const s = await currentSession();
  if (s?.user.role === "superadmin") {
    if (s.supportTenantId) await audit({ tenantId: s.supportTenantId, actorId: s.user.id, action: "support.exit", resource: `tenant:${s.supportTenantId}` });
    await createSession(s.user);
  }
  redirect("/admin");
}

// ---------------------------------------------------------------- equipe

export async function saveStaffPermissionsAction(userId: string, fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/equipe", async () => {
    const staff = await prisma.user.findFirst({ where: { id: userId, tenantId: tenant.id, role: "staff" } });
    if (!staff) throw Errors.notFound("Usuário");
    const perms = Object.fromEntries((Object.keys(STAFF_PERMISSIONS) as StaffPermission[]).map((k) => [k, fd.get(k) === "on"]));
    await prisma.user.update({ where: { id: staff.id }, data: { permissionsJson: perms, status: fd.get("active") === "on" ? "active" : "disabled" } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "staff.permissions", resource: `user:${staff.id}`, meta: perms });
    return "Permissões salvas";
  });
}

// ---------------------------------------------------------------- clientes (CRM / LGPD)

export async function updateCustomerAction(customerId: string, fd: FormData) {
  const { tenant } = await requireTenantUser({ permission: "viewCustomers" });
  await runAction(`/painel/clientes/${customerId}`, async () => {
    await updateCustomer(tenant.id, customerId, {
      name: str(fd, "name"),
      email: str(fd, "email") || null,
      notes: str(fd, "notes") || null,
      tags: str(fd, "tags").split(","),
    });
    return "Cliente atualizado";
  });
}

export async function consentAction(customerId: string, value: boolean) {
  const { user, tenant } = await requireTenantUser({ permission: "viewCustomers" });
  await runAction(`/painel/clientes/${customerId}`, async () => {
    await setWhatsappConsent(tenant.id, customerId, value, user.id);
    return value ? "Consentimento registrado" : "Mensagens automáticas desativadas para este cliente";
  });
}

export async function anonymizeCustomerAction(customerId: string, fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  if (str(fd, "confirm").toUpperCase() !== "EXCLUIR") redirect(`/painel/clientes/${customerId}?erro=` + encodeURIComponent("Digite EXCLUIR para confirmar"));
  let err: string | null = null;
  try {
    await anonymizeCustomer(tenant.id, customerId, user.id);
  } catch (e) {
    err = e instanceof Error ? e.message : "Erro";
  }
  if (err) redirect(`/painel/clientes/${customerId}?erro=` + encodeURIComponent(err));
  redirect("/painel/clientes?ok=" + encodeURIComponent("Dados pessoais do cliente excluídos (histórico mantido de forma anônima)"));
}

export async function importCustomersAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/clientes", async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw Errors.validation("Escolha um arquivo CSV");
    if (file.size > 2 * 1024 * 1024) throw Errors.validation("Arquivo maior que 2 MB");
    const r = await importCustomersCsv(tenant.id, await file.text(), user.id);
    const errs = r.errors.length ? ` ${r.errors.length} linha(s) com erro (ex.: linha ${r.errors[0].line}: ${r.errors[0].reason}).` : "";
    return `${r.created} novo(s), ${r.updated} atualizado(s), ${r.skipped} ignorado(s).${errs}`;
  });
}

export async function saveRetentionAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    const months = int(fd, "retentionMonths", 24);
    if (months !== 0 && (months < 6 || months > 120)) throw Errors.validation("Use 0 (nunca) ou entre 6 e 120 meses");
    await prisma.tenant.update({ where: { id: tenant.id }, data: { retentionMonths: months } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "retention.update", resource: `tenant:${tenant.id}`, meta: { months } });
    return "Prazo de retenção salvo";
  });
}
