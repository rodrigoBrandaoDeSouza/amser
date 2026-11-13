import { prisma } from "./db";
import { addDays, zonedToUtc } from "./time";

/**
 * Relatórios do painel (§12). Faturamento é ESTIMADO (preço dos atendimentos
 * concluídos) — não confundir com recebimentos; o Amser só vê o sinal.
 */
export interface Report {
  from: string;
  to: string;
  byStatus: Record<string, number>;
  total: number;
  revenueEstimatedCents: number; // concluídos
  revenueExpectedCents: number; // pendentes/confirmados no período
  ticketCents: number | null;
  noShowRate: number | null;
  cancelRate: number | null;
  deposits: { receivedCents: number; retainedCents: number; refundedCents: number; creditedCents: number };
  newCustomers: number;
  byService: { name: string; count: number; revenueCents: number }[];
  byProfessional: { name: string; count: number; revenueCents: number; noShows: number }[];
  byWeekday: number[];
  bySource: { public: number; manual: number };
  discountsCents: number;
}

export async function buildReport(tenantId: string, from: string, to: string, tz: string, professionalId?: string | null): Promise<Report> {
  const start = zonedToUtc(from, "00:00", tz);
  const end = zonedToUtc(addDays(to, 1), "00:00", tz);
  const appts = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: start, lt: end }, status: { not: "expirado" }, ...(professionalId ? { professionalId } : {}) },
    include: { service: { select: { name: true } }, professional: { select: { displayName: true } }, payments: true },
  });
  const byStatus: Record<string, number> = {};
  const svc = new Map<string, { name: string; count: number; revenueCents: number }>();
  const pro = new Map<string, { name: string; count: number; revenueCents: number; noShows: number }>();
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  const deposits = { receivedCents: 0, retainedCents: 0, refundedCents: 0, creditedCents: 0 };
  let revenue = 0;
  let expected = 0;
  let discounts = 0;
  const bySource = { public: 0, manual: 0 };
  for (const a of appts) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    bySource[a.source]++;
    discounts += a.discountCents;
    const wd = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(a.startsAt) + "T12:00:00Z").getUTCDay();
    byWeekday[wd]++;
    const s = svc.get(a.serviceId) ?? { name: a.service.name, count: 0, revenueCents: 0 };
    const p = pro.get(a.professionalId) ?? { name: a.professional.displayName, count: 0, revenueCents: 0, noShows: 0 };
    s.count++;
    p.count++;
    if (a.status === "concluido") {
      revenue += a.priceSnapshotCents;
      s.revenueCents += a.priceSnapshotCents;
      p.revenueCents += a.priceSnapshotCents;
    }
    if (a.status === "pendente" || a.status === "confirmado") expected += a.priceSnapshotCents;
    if (a.status === "nao_compareceu") p.noShows++;
    for (const pay of a.payments) {
      if (pay.paidAt) deposits.receivedCents += pay.amountCents;
      deposits.retainedCents += pay.retainedCents || (pay.status === "retained" ? pay.amountCents : 0);
      deposits.refundedCents += pay.refundedCents;
      deposits.creditedCents += pay.creditedCents;
    }
    svc.set(a.serviceId, s);
    pro.set(a.professionalId, p);
  }
  const done = byStatus.concluido ?? 0;
  const noShow = byStatus.nao_compareceu ?? 0;
  const cancelled = byStatus.cancelado ?? 0;
  const newCustomers = await prisma.customer.count({ where: { tenantId, createdAt: { gte: start, lt: end }, anonymizedAt: null } });
  return {
    from,
    to,
    byStatus,
    total: appts.length,
    revenueEstimatedCents: revenue,
    revenueExpectedCents: expected,
    ticketCents: done ? Math.round(revenue / done) : null,
    noShowRate: done + noShow ? noShow / (done + noShow) : null,
    cancelRate: appts.length ? cancelled / appts.length : null,
    deposits,
    newCustomers,
    byService: [...svc.values()].sort((a, b) => b.count - a.count),
    byProfessional: [...pro.values()].sort((a, b) => b.count - a.count),
    byWeekday,
    bySource,
    discountsCents: discounts,
  };
}

/** CSV dos agendamentos do período (para contador/planilha). */
export async function appointmentsCsv(tenantId: string, from: string, to: string, tz: string): Promise<string> {
  const start = zonedToUtc(from, "00:00", tz);
  const end = zonedToUtc(addDays(to, 1), "00:00", tz);
  const appts = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: start, lt: end } },
    include: { service: true, professional: true, customer: true, unit: true },
    orderBy: { startsAt: "asc" },
  });
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (!/^[+-]?[\d\s().,-]+$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["data_hora", "unidade", "profissional", "servico", "cliente", "status", "origem", "preco", "desconto", "sinal"];
  const money = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const lines = appts.map((a) =>
    [fmt.format(a.startsAt), a.unit.name, a.professional.displayName, a.service.name, a.customer.name, a.status, a.source, money(a.priceSnapshotCents), money(a.discountCents), money(a.depositAmountSnapshotCents)]
      .map(cell)
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}
