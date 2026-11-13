import { getPublicTenant } from "@/lib/public";
import { quoteCoupon } from "@/lib/coupons";
import { computeDepositCents } from "@/lib/scheduling/deposit";
import { tenantDb } from "@/lib/db";
import { isEnabled } from "@/lib/flags";
import { Errors } from "@/lib/errors";
import { errorResponse, json, limit } from "@/lib/http";

/** Prévia do desconto (não consome o cupom). Rate limit baixo contra força bruta de códigos. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    limit(req, "coupon", 15, 10 * 60_000);
    const tenant = await getPublicTenant((await params).slug);
    if (!tenant) throw Errors.notFound("Página");
    if (!(await isEnabled("coupons", tenant.id))) throw Errors.validation("Cupons indisponíveis no momento");
    const url = new URL(req.url);
    const service = await tenantDb(tenant.id).service.findFirst({ where: { id: url.searchParams.get("serviceId") ?? "", active: true } });
    if (!service) throw Errors.notFound("Serviço");
    const { coupon, discountCents } = await quoteCoupon({ tenantId: tenant.id, code: url.searchParams.get("code") ?? "", serviceId: service.id, priceCents: service.priceCents });
    const finalPriceCents = service.priceCents - discountCents;
    return json({
      code: coupon.code,
      discountCents,
      finalPriceCents,
      depositCents: computeDepositCents(finalPriceCents, service.depositType, service.depositValue),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
