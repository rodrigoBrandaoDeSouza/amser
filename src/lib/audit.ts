import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Trilha de auditoria. Nunca registrar dados pessoais completos em meta. */
export async function audit(
  entry: { tenantId?: string | null; actorId?: string | null; action: string; resource: string; meta?: Prisma.InputJsonValue },
  tx: Tx = prisma,
) {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resource: entry.resource,
      metaJson: entry.meta ?? {},
    },
  });
}
