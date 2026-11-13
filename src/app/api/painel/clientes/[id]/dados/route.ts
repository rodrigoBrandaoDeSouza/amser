import { currentSession } from "@/lib/auth/session";
import { exportCustomerData } from "@/lib/crm";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";

/** Portabilidade (LGPD art. 18): dados de um cliente em JSON. Só o dono. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await currentSession();
  const tenantId = s?.user.role === "owner" ? s.user.tenantId : s?.supportTenantId;
  if (!s || !tenantId) return new Response("unauthorized", { status: 401 });
  try {
    const { id } = await params;
    const data = await exportCustomerData(tenantId, id);
    await audit({ tenantId, actorId: s.user.id, action: "customer.export", resource: `customer:${id}` });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cliente-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(err instanceof AppError ? err.message : "erro", { status: err instanceof AppError ? err.status : 500 });
  }
}
