import { prisma } from "./db";
import { zonedToUtc, localDate } from "./time";

/**
 * Métricas de faltas (§12, pilar 2). Definição honesta: só números
 * mensuráveis — nunca "faltas evitadas".
 */
export interface NoShowMetrics {
  period: string; // YYYY-MM
  finished: number; // concluídos + faltas
  noShows: number;
  noShowRate: number | null; // 0..1
  retainedDepositsCents: number;
  depositsReceivedCents: number;
  releasedSlots: number; // liberados por falta de pagamento/confirmação
  reoccupiedSlots: number; // desses, quantos foram ocupados por outro cliente
  reoccupiedValueCents: number;
}

export function monthRange(period: string, tz: string) {
  const [y, m] = period.split("-").map(Number);
  const start = zonedToUtc(`${y}-${String(m).padStart(2, "0")}-01`, "00:00", tz);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = zonedToUtc(`${ny}-${String(nm).padStart(2, "0")}-01`, "00:00", tz);
  return { start, end };
}

export function currentPeriod(tz: string, now = new Date()) {
  return localDate(now, tz).slice(0, 7);
}

export async function noShowMetrics(tenantId: string, period: string, tz: string): Promise<NoShowMetrics> {
  const { start, end } = monthRange(period, tz);
  const inMonth = { tenantId, startsAt: { gte: start, lt: end } };

  const [finished, noShows, retained, received] = await Promise.all([
    prisma.appointment.count({ where: { ...inMonth, status: { in: ["concluido", "nao_compareceu"] } } }),
    prisma.appointment.count({ where: { ...inMonth, status: "nao_compareceu" } }),
    prisma.payment.aggregate({
      where: { tenantId, status: "retained", appointment: { startsAt: { gte: start, lt: end } } },
      _sum: { amountCents: true },
    }),
    prisma.payment.aggregate({
      where: { tenantId, status: { in: ["paid", "applied", "retained"] }, paidAt: { gte: start, lt: end } },
      _sum: { amountCents: true },
    }),
  ]);

  // Horários liberados (Pix expirado ou sem confirmação de presença) e reocupados
  // por outro agendamento que efetivamente aconteceu ou está ativo.
  const rows = await prisma.$queryRaw<{ released: bigint; reoccupied: bigint; value: bigint | null }[]>`
    WITH released AS (
      SELECT a.id, a.professional_id, a.starts_at, a.block_ends_at
      FROM appointments a
      WHERE a.tenant_id = ${tenantId}
        AND a.starts_at >= ${start} AND a.starts_at < ${end}
        AND (
          a.status = 'expirado'
          OR EXISTS (SELECT 1 FROM appointment_events e WHERE e.appointment_id = a.id AND e.event_type = 'auto_released')
        )
    ),
    reocc AS (
      SELECT DISTINCT ON (r.id) r.id, b.price_snapshot_cents
      FROM released r
      JOIN appointments b
        ON b.professional_id = r.professional_id
       AND b.id <> r.id
       AND b.created_at > (SELECT created_at FROM appointments WHERE id = r.id)
       AND b.status IN ('pendente', 'confirmado', 'concluido')
       AND tstzrange(b.starts_at, b.block_ends_at, '[)') && tstzrange(r.starts_at, r.block_ends_at, '[)')
    )
    SELECT (SELECT count(*) FROM released) AS released,
           (SELECT count(*) FROM reocc) AS reoccupied,
           (SELECT sum(price_snapshot_cents) FROM reocc) AS value
  `;
  const r = rows[0];
  return {
    period,
    finished,
    noShows,
    noShowRate: finished > 0 ? noShows / finished : null,
    retainedDepositsCents: retained._sum.amountCents ?? 0,
    depositsReceivedCents: received._sum.amountCents ?? 0,
    releasedSlots: Number(r?.released ?? 0),
    reoccupiedSlots: Number(r?.reoccupied ?? 0),
    reoccupiedValueCents: Number(r?.value ?? 0),
  };
}

export async function messageUsage(tenantId: string, now = new Date()) {
  const period = now.toISOString().slice(0, 7);
  const usage = await prisma.messageUsage.findUnique({ where: { tenantId_period: { tenantId, period } } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  const quota = usage?.quota ?? tenant?.plan?.messageQuota ?? 300;
  const sent = usage?.messagesSent ?? 0;
  return { period, sent, quota, ratio: quota > 0 ? sent / quota : 0 };
}
