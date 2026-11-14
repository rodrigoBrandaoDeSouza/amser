import dns from "node:dns/promises";
import type { Tenant } from "@prisma/client";
import { prisma, tenantDb, isUniqueViolation } from "./db";
import { Errors } from "./errors";
import { env } from "./env";
import { randomToken } from "./crypto";

/**
 * Domínio próprio (Fase 2). O dono aponta o domínio (CNAME) para o Amser e
 * prova a posse com um registro TXT. O middleware reescreve o host para a
 * página pública do tenant. O certificado HTTPS é emitido pela plataforma de
 * hospedagem: na VPS, o Caddy emite sozinho após consultar canIssueCertificate;
 * no Railway, é preciso adicionar o domínio ao serviço.
 */
export const VERIFY_PREFIX = "_amser-verify";

export function appHosts(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  try {
    hosts.add(new URL(env().APP_URL).hostname);
  } catch {
    /* ignore */
  }
  for (const h of (process.env.APP_HOSTS ?? "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return [...hosts];
}

export function normalizeHostname(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) throw Errors.validation("Domínio inválido. Ex.: agenda.seunegocio.com.br");
  if (appHosts().includes(h) || h.endsWith(".railway.app") || h.endsWith(".up.railway.app")) throw Errors.validation("Este domínio não pode ser usado");
  return h;
}

export async function addDomain(tenantId: string, input: string) {
  const hostname = normalizeHostname(input);
  const db = tenantDb(tenantId);
  if ((await db.tenantDomain.count()) >= 3) throw Errors.policy("Limite de 3 domínios por empresa");
  try {
    return await db.tenantDomain.create({ data: { tenantId, hostname, verificationToken: `amser-verify=${randomToken(16)}` } });
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.validation("Este domínio já está cadastrado");
    throw err;
  }
}

export type TxtResolver = (name: string) => Promise<string[][]>;

export async function verifyDomain(tenantId: string, domainId: string, resolveTxt: TxtResolver = dns.resolveTxt) {
  const db = tenantDb(tenantId);
  const d = await db.tenantDomain.findFirst({ where: { id: domainId } });
  if (!d) throw Errors.notFound("Domínio");
  let records: string[][] = [];
  try {
    records = await resolveTxt(`${VERIFY_PREFIX}.${d.hostname}`);
  } catch {
    throw Errors.validation(`Registro TXT ${VERIFY_PREFIX}.${d.hostname} não encontrado. A propagação do DNS pode levar algumas horas.`);
  }
  const found = records.map((r) => r.join("")).some((v) => v.trim() === d.verificationToken);
  if (!found) throw Errors.validation("O registro TXT existe, mas o valor não confere");
  return db.tenantDomain.update({ where: { id: d.id }, data: { verifiedAt: new Date() } });
}

export async function removeDomain(tenantId: string, domainId: string) {
  await tenantDb(tenantId).tenantDomain.deleteMany({ where: { id: domainId } });
}

/** Host → tenant (só domínios verificados de empresas publicadas). */
export async function tenantByHost(host: string): Promise<Tenant | null> {
  const h = host.toLowerCase().split(":")[0];
  const d = await prisma.tenantDomain.findUnique({ where: { hostname: h }, include: { tenant: true } });
  if (!d?.verifiedAt || d.tenant.status !== "active") return null;
  return d.tenant;
}

/**
 * Pode emitir certificado HTTPS para este host? Consultado pelo Caddy
 * ("on-demand TLS") antes de pedir o certificado à Let's Encrypt. Sem isso,
 * qualquer pessoa poderia apontar domínios para o servidor e esgotar o limite
 * de emissão. Libera só o domínio do Amser e domínios verificados de empresas ativas.
 */
export async function canIssueCertificate(host: string): Promise<boolean> {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /^[\d.]+$/.test(h)) return false;
  if (appHosts().includes(h)) return true;
  return (await tenantByHost(h)) !== null;
}
