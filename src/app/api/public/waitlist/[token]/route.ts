import { z } from "zod";
import { bookFromWaitlist, verifyWaitlistToken } from "@/lib/waitlist";
import { getAvailability } from "@/lib/scheduling/booking";
import { prisma, tenantDb } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";
import { formatTime } from "@/lib/time";

async function load(token: string) {
  const claims = await verifyWaitlistToken(token);
  if (!claims) throw Errors.notFound("Oferta");
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tid } });
  if (!tenant || tenant.status !== "active") throw Errors.notFound("Oferta");
  const entry = await tenantDb(tenant.id).waitlistEntry.findFirst({ where: { id: claims.wid } });
  if (!entry) throw Errors.notFound("Oferta");
  return { tenant, entry };
}

/** Horários disponíveis agora para a oferta. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    limit(req, "waitlist-offer", 60, 60_000);
    const { tenant, entry } = await load((await params).token);
    if (!["waiting", "offered"].includes(entry.status)) return json({ status: entry.status, slots: [] });
    const slots = await getAvailability({ tenant, serviceId: entry.serviceId, professionalId: entry.professionalId, unitId: entry.unitId, date: entry.date });
    return json({ status: entry.status, slots: slots.map((s) => ({ startsAt: s.startsAt, label: formatTime(new Date(s.startsAt), tenant.timezone) })) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    limit(req, "waitlist-book", 10, 10 * 60_000);
    const body = z.object({ startsAt: z.string().datetime() }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw Errors.validation("Horário inválido");
    const r = await bookFromWaitlist((await params).token, body.data.startsAt);
    return json({ token: r.token, status: r.appointment.status }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
