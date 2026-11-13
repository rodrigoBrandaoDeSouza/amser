import type { Customer, Prisma } from "@prisma/client";
import { tenantDb } from "./db";
import { Errors } from "./errors";
import { normalizePhoneBR } from "./format";

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  consentWhatsapp: boolean;
}

/** Valida e normaliza dados do cliente final. */
export function parseCustomer(input: CustomerInput) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw Errors.validation("Informe seu nome");
  const phone = normalizePhoneBR(input.phone);
  if (!phone) throw Errors.validation("Telefone inválido. Use DDD + número.");
  const email = input.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Errors.validation("E-mail inválido");
  return { name, phone, email, consentWhatsapp: input.consentWhatsapp };
}

/** Deduplicação por telefone dentro do tenant (§10), registrando o consentimento. */
export async function upsertCustomer(tenantId: string, input: CustomerInput, source: string, now = new Date()): Promise<Customer> {
  const c = parseCustomer(input);
  const db = tenantDb(tenantId);
  const existing = await db.customer.findFirst({ where: { phoneE164: c.phone } });
  const consent = {
    ...((existing?.consentJson as Record<string, unknown>) ?? {}),
    whatsapp: c.consentWhatsapp,
    whatsappAt: now.toISOString(),
    source,
  } as Prisma.InputJsonValue;
  return existing
    ? db.customer.update({ where: { id: existing.id }, data: { name: c.name, email: c.email ?? existing.email, consentJson: consent } })
    : db.customer.create({ data: { tenantId, name: c.name, phoneE164: c.phone, email: c.email, consentJson: consent } });
}
