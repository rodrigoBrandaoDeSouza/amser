import type { Prisma } from "@prisma/client";
import { prisma, tenantDb } from "./db";
import { Errors } from "./errors";
import { audit } from "./audit";
import { normalizePhoneBR } from "./format";

// ---------------------------------------------------------------- CSV

/** Parser CSV simples (RFC 4180: aspas, vírgula ou ponto e vírgula). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");
const COLS = {
  name: ["nome", "name", "cliente"],
  phone: ["telefone", "celular", "whatsapp", "phone", "fone"],
  email: ["email", "e-mail", "e_mail"],
  notes: ["observacoes", "obs", "notas", "notes"],
  tags: ["etiquetas", "tags"],
  consent: ["aceita_whatsapp", "consentimento", "opt_in"],
};

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; reason: string }[];
}

/**
 * Importa clientes de CSV (§10). Deduplica por telefone dentro do tenant.
 * O consentimento só é marcado se a coluna "aceita_whatsapp" disser "sim" —
 * o dono declara ter obtido o opt-in (LGPD); fica registrado como "importação".
 */
export async function importCustomersCsv(tenantId: string, csv: string, actorId: string): Promise<ImportResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw Errors.validation("Arquivo vazio ou sem cabeçalho");
  if (rows.length > 5001) throw Errors.validation("Máximo de 5.000 clientes por importação");
  const header = rows[0].map(norm);
  const idx = (k: keyof typeof COLS) => header.findIndex((h) => COLS[k].includes(h));
  const iName = idx("name");
  const iPhone = idx("phone");
  if (iName < 0 || iPhone < 0) throw Errors.validation("O CSV precisa das colunas 'nome' e 'telefone'");
  const [iEmail, iNotes, iTags, iConsent] = [idx("email"), idx("notes"), idx("tags"), idx("consent")];

  const db = tenantDb(tenantId);
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
    const name = get(iName).slice(0, 120);
    const phone = normalizePhoneBR(get(iPhone));
    if (name.length < 2) {
      res.errors.push({ line: r + 1, reason: "nome vazio" });
      continue;
    }
    if (!phone) {
      res.errors.push({ line: r + 1, reason: `telefone inválido: ${get(iPhone).slice(0, 20)}` });
      continue;
    }
    if (seen.has(phone)) {
      res.skipped++;
      continue;
    }
    seen.add(phone);
    const email = get(iEmail) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get(iEmail)) ? get(iEmail).toLowerCase() : null;
    const tags = get(iTags).split(/[|,]/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10);
    const consentYes = ["sim", "s", "yes", "true", "1"].includes(get(iConsent).toLowerCase());
    const existing = await db.customer.findFirst({ where: { phoneE164: phone } });
    if (existing?.anonymizedAt) {
      res.skipped++;
      continue;
    }
    if (existing) {
      await db.customer.update({
        where: { id: existing.id },
        data: {
          email: existing.email ?? email,
          notes: existing.notes ?? (get(iNotes).slice(0, 1000) || null),
          tags: [...new Set([...existing.tags, ...tags])].slice(0, 20),
        },
      });
      res.updated++;
    } else {
      const consent = (consentYes ? { whatsapp: true, whatsappAt: new Date().toISOString(), source: "importacao" } : { whatsapp: false, source: "importacao" }) as Prisma.InputJsonValue;
      await db.customer.create({ data: { tenantId, name, phoneE164: phone, email, notes: get(iNotes).slice(0, 1000) || null, tags, consentJson: consent } });
      res.created++;
    }
  }
  await audit({ tenantId, actorId, action: "customers.import", resource: `tenant:${tenantId}`, meta: { created: res.created, updated: res.updated, errors: res.errors.length } });
  return res;
}

// ---------------------------------------------------------------- edição

export async function updateCustomer(tenantId: string, customerId: string, data: { name: string; email: string | null; notes: string | null; tags: string[] }) {
  const db = tenantDb(tenantId);
  const c = await db.customer.findFirst({ where: { id: customerId } });
  if (!c || c.anonymizedAt) throw Errors.notFound("Cliente");
  if (data.name.trim().length < 2) throw Errors.validation("Nome obrigatório");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw Errors.validation("E-mail inválido");
  return db.customer.update({
    where: { id: c.id },
    data: {
      name: data.name.trim().slice(0, 120),
      email: data.email?.toLowerCase() || null,
      notes: data.notes?.slice(0, 1000) || null,
      tags: [...new Set(data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
    },
  });
}

/** Revoga (ou reativa) o consentimento de WhatsApp pelo painel. */
export async function setWhatsappConsent(tenantId: string, customerId: string, value: boolean, actorId: string) {
  const db = tenantDb(tenantId);
  const c = await db.customer.findFirst({ where: { id: customerId } });
  if (!c || c.anonymizedAt) throw Errors.notFound("Cliente");
  const consent = { ...((c.consentJson as Record<string, unknown>) ?? {}), whatsapp: value, whatsappAt: new Date().toISOString(), source: "painel" };
  await db.customer.update({ where: { id: c.id }, data: { consentJson: consent, optedOutAt: value ? null : new Date() } });
  if (!value) await db.messageOutbox.updateMany({ where: { toPhoneE164: c.phoneE164, status: "pending" }, data: { status: "skipped", lastError: "consentimento revogado" } });
  await audit({ tenantId, actorId, action: value ? "customer.opt_in" : "customer.opt_out", resource: `customer:${c.id}` });
}

// ---------------------------------------------------------------- LGPD

/** Portabilidade (LGPD art. 18): todos os dados de um cliente em JSON. */
export async function exportCustomerData(tenantId: string, customerId: string) {
  const db = tenantDb(tenantId);
  const c = await db.customer.findFirst({
    where: { id: customerId },
    include: {
      appointments: { include: { service: { select: { name: true } }, professional: { select: { displayName: true } }, payments: true } },
      credits: true,
      waitlist: true,
    },
  });
  if (!c) throw Errors.notFound("Cliente");
  return {
    geradoEm: new Date().toISOString(),
    cliente: { nome: c.name, telefone: c.phoneE164, email: c.email, observacoes: c.notes, etiquetas: c.tags, consentimento: c.consentJson, cadastradoEm: c.createdAt },
    agendamentos: c.appointments.map((a) => ({
      servico: a.service.name,
      profissional: a.professional.displayName,
      inicio: a.startsAt,
      status: a.status,
      precoCentavos: a.priceSnapshotCents,
      sinalCentavos: a.depositAmountSnapshotCents,
      pagamentos: a.payments.map((p) => ({ valorCentavos: p.amountCents, status: p.status, pagoEm: p.paidAt })),
    })),
    creditos: c.credits.map((k) => ({ valorCentavos: k.amountCents, motivo: k.reason, em: k.createdAt })),
    listaDeEspera: c.waitlist.map((w) => ({ data: w.date, status: w.status })),
  };
}

/**
 * Eliminação (LGPD art. 18): anonimiza o cliente mantendo os números
 * agregados (agendamentos e pagamentos ficam, sem dado pessoal).
 */
export async function anonymizeCustomer(tenantId: string, customerId: string, actorId: string | null, opts: { force?: boolean } = {}) {
  const db = tenantDb(tenantId);
  const c = await db.customer.findFirst({ where: { id: customerId } });
  if (!c) throw Errors.notFound("Cliente");
  if (c.anonymizedAt) return c;
  const future = await db.appointment.count({ where: { customerId: c.id, status: { in: ["aguardando_sinal", "pendente", "confirmado"] }, startsAt: { gt: new Date() } } });
  if (future && !opts.force) throw Errors.policy("Este cliente tem agendamentos futuros. Cancele-os antes de excluir os dados.");
  await prisma.$transaction([
    prisma.messageOutbox.updateMany({ where: { tenantId, toPhoneE164: c.phoneE164, status: "pending" }, data: { status: "skipped", lastError: "cliente anonimizado" } }),
    prisma.messageOutbox.updateMany({ where: { tenantId, toPhoneE164: c.phoneE164 }, data: { toPhoneE164: `anon:${c.id}`, payloadJson: {} } }),
    prisma.waitlistEntry.updateMany({ where: { tenantId, customerId: c.id, status: { in: ["waiting", "offered"] } }, data: { status: "cancelled" } }),
    prisma.customer.update({
      where: { id: c.id },
      data: {
        name: "Cliente removido",
        phoneE164: `anon:${c.id}`,
        email: null,
        notes: null,
        tags: [],
        consentJson: {},
        whatsappUserId: null,
        anonymizedAt: new Date(),
        optedOutAt: c.optedOutAt ?? new Date(),
      },
    }),
  ]);
  await audit({ tenantId, actorId, action: "customer.anonymize", resource: `customer:${c.id}` });
}

/** Retenção (job): anonimiza clientes sem atividade há `retentionMonths`. */
export async function applyRetention(now = new Date()): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { status: { in: ["active", "onboarding", "suspended"] }, retentionMonths: { gt: 0 } }, select: { id: true, retentionMonths: true } });
  let n = 0;
  for (const t of tenants) {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - t.retentionMonths);
    const stale = await prisma.customer.findMany({
      where: {
        tenantId: t.id,
        anonymizedAt: null,
        createdAt: { lt: cutoff },
        appointments: { none: { startsAt: { gte: cutoff } } },
        waitlist: { none: { createdAt: { gte: cutoff } } },
      },
      select: { id: true },
      take: 200,
    });
    for (const s of stale) {
      await anonymizeCustomer(t.id, s.id, null, { force: true });
      n++;
    }
  }
  return n;
}
