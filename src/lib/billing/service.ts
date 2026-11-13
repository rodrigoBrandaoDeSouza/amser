import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { billingProvider } from "./provider";
import { billingEnabled } from "../env";

type Tx = Prisma.TransactionClient | PrismaClient;

export const TRIAL_DAYS = 14;
export const INVOICE_LEAD_DAYS = 5; // fatura gerada X dias antes do vencimento
export const GRACE_DAYS = 5; // tolerância após o vencimento antes de suspender

const DAY = 86400_000;

/** Soma meses sem "pular" o mês (31/01 + 1 mês = 28 ou 29/02). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** Inicia o período de teste de uma empresa nova. */
export async function startTrial(tx: Tx, tenantId: string, planId: string, now = new Date()) {
  const existing = await tx.subscription.findFirst({ where: { tenantId, status: { in: ["trialing", "active", "past_due"] } } });
  if (existing) return existing;
  const end = new Date(now.getTime() + TRIAL_DAYS * DAY);
  return tx.subscription.create({
    data: { tenantId, planId, status: "trialing", periodStart: now, periodEnd: end, trialEndsAt: end },
  });
}

/**
 * Ciclo de cobrança (job):
 *  1. gera a fatura do próximo período alguns dias antes do vencimento;
 *  2. venceu sem pagamento → past_due com tolerância;
 *  3. tolerância esgotada → suspende a empresa (motivo "billing").
 */
export async function runBillingCycle(now = new Date()) {
  const stats = { invoices: 0, pastDue: 0, suspended: 0 };
  // Sem PSP de cobrança: nada automático (nem fatura, nem suspensão). Cobrança manual pelo superadmin.
  if (!billingEnabled()) return stats;
  const provider = billingProvider();

  const due = await prisma.subscription.findMany({
    where: { status: { in: ["trialing", "active", "past_due"] }, periodEnd: { lte: new Date(now.getTime() + INVOICE_LEAD_DAYS * DAY) } },
    include: { plan: true, tenant: true },
    take: 200,
  });
  for (const sub of due) {
    if (sub.tenant.status === "deleted" || sub.tenant.status === "prospect") continue;
    const nextStart = sub.periodEnd;
    const exists = await prisma.billingInvoice.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: sub.id, periodStart: nextStart } } });
    if (!exists && sub.plan.priceCents > 0) {
      const charge = await provider.createCharge({
        tenantId: sub.tenantId,
        amountCents: sub.plan.priceCents,
        dueAt: nextStart,
        description: `Amser — plano ${sub.plan.name}`,
      });
      const created = await prisma.billingInvoice.createMany({
        data: [
          {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            amountCents: sub.plan.priceCents,
            periodStart: nextStart,
            periodEnd: addMonths(nextStart, 1),
            dueAt: nextStart,
            provider: provider.name,
            providerChargeId: charge.chargeId,
            pixCopyPaste: charge.pixCopyPaste,
          },
        ],
        skipDuplicates: true,
      });
      stats.invoices += created.count;
    }

    if (sub.periodEnd <= now && sub.status !== "past_due") {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "past_due", graceUntil: new Date(sub.periodEnd.getTime() + GRACE_DAYS * DAY) } });
      await audit({ tenantId: sub.tenantId, action: "billing.past_due", resource: `subscription:${sub.id}` });
      stats.pastDue++;
    }
  }

  const overdue = await prisma.subscription.findMany({
    where: { status: "past_due", graceUntil: { lt: now }, tenant: { status: { in: ["active", "onboarding"] } } },
    include: { tenant: true },
  });
  for (const sub of overdue) {
    const r = await prisma.tenant.updateMany({
      where: { id: sub.tenantId, status: { in: ["active", "onboarding"] } },
      data: { status: "suspended", suspendedReason: "billing", statusBeforeSuspension: sub.tenant.status },
    });
    if (r.count) {
      await audit({ tenantId: sub.tenantId, action: "billing.suspended", resource: `tenant:${sub.tenantId}` });
      stats.suspended++;
    }
  }
  return stats;
}

export type BillingWebhookResult = { ok: true; outcome: "paid" | "duplicate" | "ignored" } | { ok: false; status: number; reason: string };

/** Fatura paga → assinatura ativa no novo período; reativa se a suspensão foi por cobrança. */
export async function handleBillingWebhook(providerName: string, rawBody: string, headers: Headers): Promise<BillingWebhookResult> {
  let event;
  try {
    event = billingProvider(providerName).parseWebhook(rawBody, headers);
  } catch {
    return { ok: false, status: 401, reason: "assinatura inválida" };
  }
  if (!event) return { ok: true, outcome: "ignored" };
  const ins = await prisma.webhookEvent.createMany({ data: [{ provider: `billing:${providerName}`, externalId: event.eventId }], skipDuplicates: true });
  if (!ins.count) return { ok: true, outcome: "duplicate" };

  const invoice = await prisma.billingInvoice.findUnique({ where: { providerChargeId: event.chargeId } });
  if (!invoice) return { ok: true, outcome: "ignored" };
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const marked = await tx.billingInvoice.updateMany({ where: { id: invoice.id, status: "open" }, data: { status: "paid", paidAt: now } });
    if (!marked.count) return "duplicate" as const;
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId } });
    // Só avança o período se a fatura for do período seguinte ao atual.
    if (invoice.periodStart >= sub.periodStart) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: "active", periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, graceUntil: null },
      });
    }
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });
    if (tenant.status === "suspended" && tenant.suspendedReason === "billing") {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: tenant.statusBeforeSuspension ?? "active", suspendedReason: null, statusBeforeSuspension: null },
      });
    }
    await audit({ tenantId: invoice.tenantId, action: "billing.paid", resource: `invoice:${invoice.id}` }, tx);
    return "paid" as const;
  });
  return { ok: true, outcome };
}

export async function changePlan(tenantId: string, planId: string, actorId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error("Plano inexistente");
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { planId } });
    // Vale a partir da próxima fatura.
    await tx.subscription.updateMany({ where: { tenantId, status: { in: ["trialing", "active", "past_due"] } }, data: { planId } });
    await audit({ tenantId, actorId, action: "billing.plan_change", resource: `tenant:${tenantId}`, meta: { planId } }, tx);
  });
}

export async function mrrCents(): Promise<number> {
  const subs = await prisma.subscription.findMany({ where: { status: "active" }, include: { plan: true } });
  return subs.reduce((s, x) => s + x.plan.priceCents, 0);
}

/**
 * Cobrança manual (enquanto não há PSP): a equipe registra que a empresa
 * pagou e a assinatura avança um mês. Fica na auditoria.
 */
export async function registerManualPayment(tenantId: string, actorId: string, now = new Date()) {
  const sub = await prisma.subscription.findFirst({ where: { tenantId }, orderBy: { periodEnd: "desc" } });
  if (!sub) throw new Error("Empresa sem assinatura");
  const start = sub.periodEnd > now ? sub.periodEnd : now;
  const end = addMonths(start, 1);
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { status: "active", periodStart: start, periodEnd: end, graceUntil: null } });
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if (t.status === "suspended" && t.suspendedReason === "billing") {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: t.statusBeforeSuspension ?? "active", suspendedReason: null, statusBeforeSuspension: null } });
    }
    await audit({ tenantId, actorId, action: "billing.manual_payment", resource: `subscription:${sub.id}`, meta: { until: end.toISOString() } }, tx);
  });
  return end;
}
