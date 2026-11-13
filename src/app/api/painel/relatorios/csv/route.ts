import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { appointmentsCsv } from "@/lib/reports";
import { isValidDate, localDate } from "@/lib/time";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "owner" || !user.tenantId) return new Response("unauthorized", { status: 401 });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const url = new URL(req.url);
  const today = localDate(new Date(), tenant.timezone);
  const from = isValidDate(url.searchParams.get("de") ?? "") ? url.searchParams.get("de")! : `${today.slice(0, 7)}-01`;
  const to = isValidDate(url.searchParams.get("ate") ?? "") ? url.searchParams.get("ate")! : today;
  const csv = await appointmentsCsv(tenant.id, from, to, tenant.timezone);
  await audit({ tenantId: tenant.id, actorId: user.id, action: "report.export", resource: `tenant:${tenant.id}`, meta: { from, to } });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="agendamentos-${from}-a-${to}.csv"`, "Cache-Control": "no-store" },
  });
}
