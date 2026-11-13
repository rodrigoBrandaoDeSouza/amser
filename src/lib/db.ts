import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Cliente "cru". Use APENAS em: superadmin, jobs globais, webhooks (antes de
 * resolver o tenant) e resolução de slug público. Todo o resto usa tenantDb().
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

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

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
