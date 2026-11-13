import { z } from "zod";
import { getPublicTenant } from "@/lib/public";
import { createBooking } from "@/lib/scheduling/booking";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";
import { normalizePhoneBR } from "@/lib/format";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  serviceId: z.string().min(1).max(40),
  professionalId: z.string().max(40).nullable(),
  unitId: z.string().max(40).nullable().optional(),
  startsAt: z.string().datetime(),
  couponCode: z.string().max(40).nullable().optional(),
  customer: z.object({
    name: z.string().min(2).max(120),
    phone: z.string().min(8).max(25),
    email: z.string().max(160).nullable().optional(),
    consentWhatsapp: z.boolean(),
  }),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    limit(req, "booking", 10, 10 * 60_000);
    const { slug } = await params;
    const tenant = await getPublicTenant(slug);
    if (!tenant) throw Errors.notFound("Página");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw Errors.validation("Dados inválidos");
    const phone = normalizePhoneBR(parsed.data.customer.phone);
    if (phone && !rateLimit(`booking-phone:${tenant.id}:${phone}`, 5, 60 * 60_000)) throw Errors.rateLimited();

    const result = await createBooking({ tenant, ...parsed.data, source: "public" });
    return json(
      {
        token: result.token,
        status: result.appointment.status,
        discountCents: result.discountCents,
        creditAppliedCents: result.creditAppliedCents,
        payment: result.payment ? { amountCents: result.payment.amountCents, expiresAt: result.payment.expiresAt } : null,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
