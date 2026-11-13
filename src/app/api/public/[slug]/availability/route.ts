import { getPublicTenant } from "@/lib/public";
import { getAvailability } from "@/lib/scheduling/booking";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";
import { formatTime } from "@/lib/time";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    limit(req, "availability", 120, 60_000);
    const { slug } = await params;
    const tenant = await getPublicTenant(slug);
    if (!tenant) throw Errors.notFound("Página");
    const url = new URL(req.url);
    const serviceId = url.searchParams.get("serviceId") ?? "";
    const date = url.searchParams.get("date") ?? "";
    const professionalId = url.searchParams.get("professionalId") || null;
    const slots = await getAvailability({ tenant, serviceId, professionalId, date });
    // Não expõe quais profissionais estão livres — só os horários.
    return json({ slots: slots.map((s) => ({ startsAt: s.startsAt, label: formatTime(new Date(s.startsAt), tenant.timezone) })) });
  } catch (err) {
    return errorResponse(err);
  }
}
