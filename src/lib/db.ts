import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Cliente "cru". Use APENAS em: superadmin, jobs globais, webhooks (antes de
 * resolver o tenant) e resolução de slug público. Todo o resto usa tenantDb().
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Modelos com coluna tenant_id — o isolamento é aplicado automaticamente. */
const TENANT_MODELS = new Set<string>([
  "TenantBranding",
  "TenantMedia",
  "Unit",
  "Professional",
  "ServiceCategory",
  "Service",
  "ServiceProfessional",
  "WorkingHour",
  "ScheduleException",
  "Customer",
  "Appointment",
  "AppointmentEvent",
  "PaymentConnection",
  "Payment",
  "WhatsappConnection",
  "MessageTemplate",
  "MessageOutbox",
  "MessageUsage",
  "Subscription",
  // Fase 2
  "TenantDomain",
  "Coupon",
  "CustomerCredit",
  "WaitlistEntry",
  "BillingInvoice",
  "InstagramConnection",
]);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

function scopeArgs(operation: string, args: AnyArgs, tenantId: string): AnyArgs {
  const a: AnyArgs = { ...(args ?? {}) };
  const withWhere = () => {
    a.where = { ...(a.where ?? {}), tenantId };
  };
  switch (operation) {
    case "findUnique":
    case "findUniqueOrThrow":
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "update":
    case "updateMany":
    case "delete":
    case "deleteMany":
      withWhere();
      break;
    case "create":
      a.data = { ...(a.data as object), tenantId };
      break;
    case "createMany":
    case "createManyAndReturn": {
      const d = a.data;
      a.data = Array.isArray(d) ? d.map((x) => ({ ...x, tenantId })) : { ...(d as object), tenantId };
      break;
    }
    case "upsert":
      withWhere();
      a.create = { ...(a.create ?? {}), tenantId };
      break;
    default:
      throw new Error(`Operação ${operation} não suportada em tenantDb`);
  }
  // Impede que um update troque o tenant do registro.
  if ((operation === "update" || operation === "updateMany" || operation === "upsert") && a.data) {
    const d = a.data as Record<string, unknown>;
    if ("tenantId" in d && d.tenantId !== tenantId) throw new Error("Alteração de tenantId proibida");
  }
  return a;
}

function tenantExtension(tenantId: string) {
  return Prisma.defineExtension({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            throw new Error(`Modelo ${model} não é tenant-scoped; use prisma diretamente com cuidado`);
          }
          return query(scopeArgs(operation, args as AnyArgs, tenantId) as never);
        },
      },
    },
  });
}

/**
 * Cliente com isolamento obrigatório por tenant. O tenantId SEMPRE vem do
 * contexto autenticado ou do slug resolvido no servidor — nunca do cliente.
 */
export function tenantDb(tenantId: string, client: PrismaClient = prisma) {
  if (!tenantId) throw new Error("tenantId obrigatório");
  return client.$extends(tenantExtension(tenantId));
}

export type TenantDb = ReturnType<typeof tenantDb>;

/** Erro do Postgres para violação de exclusion constraint. */
export function isOverlapViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = JSON.stringify(err.meta ?? {});
    return meta.includes("23P01") || meta.includes("appointments_no_overlap") || err.message.includes("appointments_no_overlap");
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return err.message.includes("23P01") || err.message.includes("appointments_no_overlap");
  }
  return false;
}

/**
 * Erros transitórios de concorrência: deadlock (40P01), serialização (40001),
 * conflito de escrita (P2034) e transação expirada por espera de lock (P2028).
 * Devem ser retentados — não indicam conflito de horário.
 */
export function isTransientTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "P2028")) return true;
  const msg = err instanceof Error ? err.message : "";
  return /40P01|deadlock detected|40001|could not serialize|55P03/.test(msg);
}

/**
 * Serializa as escritas de agenda de UM profissional dentro da transação.
 * Sem isso, duas inserções concorrentes no mesmo intervalo entram em deadlock
 * na exclusion constraint (cada uma insere e depois espera a outra) e o
 * Postgres só resolve após deadlock_timeout (1 s) — sob pico, dezenas de
 * segundos. Com o lock, a segunda espera milissegundos e já vê o conflito.
 */
export async function lockProfessionalSchedule(tx: Prisma.TransactionClient, professionalId: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtextextended(${professionalId}, 0))) AS l`;
}

/** Opções das transações curtas de agenda (a constraint pode esperar a outra transação terminar). */
export const BOOKING_TX = { maxWait: 10_000, timeout: 15_000 } as const;

/** Executa fn com até `attempts` tentativas em erros transitórios (backoff com jitter). */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientTxError(err) || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 25 * (i + 1) + Math.random() * 50));
    }
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
