"use server";

import type { DepositRefundMode } from "@prisma/client";
import { requireTenantUser } from "@/lib/auth/session";
import { runAction, str, int } from "@/lib/actions";
import { Errors } from "@/lib/errors";
import { parseBRL } from "@/lib/format";
import { audit } from "@/lib/audit";
import { prisma, isUniqueViolation } from "@/lib/db";
import { assertWithinPlan } from "@/lib/plans";
import { normalizeCode } from "@/lib/coupons";
import { cancelWaitlistEntry } from "@/lib/waitlist";
import { addDomain, removeDomain, verifyDomain } from "@/lib/domains";
import { disconnectInstagram, importInstagramMedia } from "@/lib/instagram/service";
import { zonedToUtc, isValidDate } from "@/lib/time";

const TIMEZONES = new Set([
  "America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem", "America/Manaus",
  "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha",
]);

// ---------------------------------------------------------------- unidades

export async function saveUnitAction(fd: FormData) {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel/unidades", async () => {
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (name.length < 2) throw Errors.validation("Nome obrigatório");
    const timezone = TIMEZONES.has(str(fd, "timezone")) ? str(fd, "timezone") : "America/Sao_Paulo";
    const active = id ? fd.get("active") === "on" : true;
    if (!id || active) {
      const current = id ? await db.unit.findFirst({ where: { id } }) : null;
      if (!current?.active) await assertWithinPlan(tenant, "units");
    }
    if (id && !active) {
      const others = await db.unit.count({ where: { active: true, id: { not: id } } });
      if (!others) throw Errors.policy("A empresa precisa de ao menos uma unidade ativa");
    }
    const data = { name, address: str(fd, "address").slice(0, 200) || null, phone: str(fd, "phone") || null, timezone, active, sortOrder: int(fd, "sortOrder") };
    const unit = id ? await db.unit.update({ where: { id }, data }) : await db.unit.create({ data: { ...data, tenantId: tenant.id } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: id ? "unit.update" : "unit.create", resource: `unit:${unit.id}` });
    return "Unidade salva";
  });
}

// ---------------------------------------------------------------- cupons

export async function saveCouponAction(fd: FormData) {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel/cupons", async () => {
    const code = normalizeCode(str(fd, "code"));
    if (code.length < 3) throw Errors.validation("Código com ao menos 3 caracteres (letras e números)");
    const type = str(fd, "discountType") === "fixed" ? "fixed" : "percent";
    const value = type === "percent" ? Math.min(100, Math.max(1, int(fd, "discountPercent"))) : (parseBRL(str(fd, "discountFixed")) ?? 0);
    if (value <= 0) throw Errors.validation("Informe o desconto");
    const from = str(fd, "validFrom");
    const until = str(fd, "validUntil");
    if ((from && !isValidDate(from)) || (until && !isValidDate(until))) throw Errors.validation("Data inválida");
    const maxRed = str(fd, "maxRedemptions") ? Math.max(1, int(fd, "maxRedemptions")) : null;
    const serviceIds = fd.getAll("serviceIds").map(String);
    const valid = (await db.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true } })).map((s) => s.id);
    try {
      const c = await db.coupon.create({
        data: {
          tenantId: tenant.id,
          code,
          discountType: type,
          discountValue: value,
          serviceIds: valid,
          validFrom: from ? zonedToUtc(from, "00:00", tenant.timezone) : null,
          validUntil: until ? zonedToUtc(until, "23:59", tenant.timezone) : null,
          maxRedemptions: maxRed,
          maxPerCustomer: Math.max(1, int(fd, "maxPerCustomer", 1)),
        },
      });
      await audit({ tenantId: tenant.id, actorId: user.id, action: "coupon.create", resource: `coupon:${c.id}` });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.validation("Já existe um cupom com esse código");
      throw err;
    }
    return `Cupom ${code} criado`;
  });
}

export async function toggleCouponAction(id: string) {
  const { db } = await requireTenantUser();
  await runAction("/painel/cupons", async () => {
    const c = await db.coupon.findFirst({ where: { id } });
    if (!c) throw Errors.notFound("Cupom");
    await db.coupon.update({ where: { id }, data: { active: !c.active } });
    return c.active ? "Cupom pausado" : "Cupom reativado";
  });
}

// ---------------------------------------------------------------- lista de espera

export async function cancelWaitlistAction(id: string) {
  const { tenant } = await requireTenantUser();
  await runAction("/painel/lista-de-espera", async () => {
    await cancelWaitlistEntry(tenant.id, id);
    return "Removido da lista";
  });
}

// ---------------------------------------------------------------- políticas

export async function savePoliciesAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    const pct = (k: string, def: number) => Math.min(100, Math.max(0, int(fd, k, def)));
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        depositRefundMode: (str(fd, "depositRefundMode") === "credit" ? "credit" : "refund") as DepositRefundMode,
        lateCancelRetainPercent: pct("lateCancelRetainPercent", 100),
        noShowRetainPercent: pct("noShowRetainPercent", 100),
        waitlistEnabled: fd.get("waitlistEnabled") === "on",
      },
    });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "policies.update", resource: `tenant:${tenant.id}` });
    return "Políticas de sinal salvas";
  });
}

// ---------------------------------------------------------------- domínio próprio

export async function addDomainAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    const d = await addDomain(tenant.id, str(fd, "hostname"));
    await audit({ tenantId: tenant.id, actorId: user.id, action: "domain.add", resource: `domain:${d.id}`, meta: { hostname: d.hostname } });
    return "Domínio adicionado. Configure o DNS e clique em Verificar.";
  });
}

export async function verifyDomainAction(id: string) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    const d = await verifyDomain(tenant.id, id);
    await audit({ tenantId: tenant.id, actorId: user.id, action: "domain.verify", resource: `domain:${d.id}` });
    return `${d.hostname} verificado!`;
  });
}

export async function removeDomainAction(id: string) {
  const { tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    await removeDomain(tenant.id, id);
    return "Domínio removido";
  });
}

// ---------------------------------------------------------------- instagram

export async function importInstagramAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/marca/instagram", async () => {
    const r = await importInstagramMedia(tenant.id, user.id, fd.getAll("media").map(String));
    return r.failed ? `${r.imported} foto(s) importada(s); ${r.failed} não puderam ser importadas.` : `${r.imported} foto(s) importada(s). Gere o tema em Marca.`;
  });
}

export async function disconnectInstagramAction() {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/marca/instagram", async () => {
    await disconnectInstagram(tenant.id, user.id);
    return "Instagram desconectado";
  });
}
