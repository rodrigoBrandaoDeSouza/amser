import { z } from "zod";
import { getPublicTenant } from "@/lib/public";
import { joinWaitlist } from "@/lib/waitlist";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";

const Body = z.object({
  serviceId: z.string().min(1).max(40),
  professionalId: z.string().max(40).nullable(),
  unitId: z.string().max(40).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customer: z.object({
    name: z.string().min(2).max(120),
    phone: z.string().min(8).max(25),
    email: z.string().max(160).nullable().optional(),
    consentWhatsapp: z.boolean(),
  }),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    limit(req, "waitlist", 6, 10 * 60_000);
    const tenant = await getPublicTenant((await params).slug);
    if (!tenant) throw Errors.notFound("Página");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw Errors.validation("Dados inválidos");
    await joinWaitlist({ tenant, ...parsed.data });
    return json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
