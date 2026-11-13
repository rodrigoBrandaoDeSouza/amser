import { z } from "zod";
import { verifyActionToken } from "@/lib/tokens";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";
import { tenantDb } from "@/lib/db";
import { cancelAppointment, confirmPresence, rescheduleAppointment } from "@/lib/scheduling/booking";

/** Estado do agendamento (a página /a/[token] faz polling enquanto aguarda o Pix). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    limit(req, "appt-status", 120, 60_000);
    const claims = await verifyActionToken((await params).token);
    if (!claims) throw Errors.notFound("Agendamento");
    const appt = await tenantDb(claims.tid).appointment.findFirst({ where: { id: claims.aid }, select: { status: true } });
    if (!appt) throw Errors.notFound("Agendamento");
    return json({ status: appt.status });
  } catch (err) {
    return errorResponse(err);
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reschedule"), startsAt: z.string().datetime() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    limit(req, "appt-action", 20, 10 * 60_000);
    const claims = await verifyActionToken((await params).token);
    if (!claims) throw Errors.notFound("Agendamento");
    const body = Action.safeParse(await req.json().catch(() => null));
    if (!body.success) throw Errors.validation("Ação inválida");
    if (body.data.action === "confirm") await confirmPresence(claims.tid, claims.aid);
    else if (body.data.action === "cancel") {
      const r = await cancelAppointment(claims.tid, claims.aid, { kind: "customer" });
      return json({ ok: true, ...r });
    } else await rescheduleAppointment(claims.tid, claims.aid, body.data.startsAt, { kind: "customer" });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
