import { currentUser } from "@/lib/auth/session";
import { tenantDb } from "@/lib/db";
import { audit } from "@/lib/audit";

/** Exportação da base (pilar 3 + LGPD). Só o dono do tenant. */
export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "owner" || !user.tenantId) return new Response("unauthorized", { status: 401 });
  const customers = await tenantDb(user.tenantId).customer.findMany({
    where: { anonymizedAt: null },
    include: { appointments: { select: { status: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Neutraliza fórmulas (CSV injection) e escapa aspas.
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Telefones/números com sinal são seguros; o resto que começa com =,+,-,@ vira texto.
    const numeric = /^[+-]?[\d\s().-]+$/.test(s);
    if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["nome", "telefone", "email", "observacoes", "etiquetas", "aceita_whatsapp", "atendimentos", "faltas", "cancelamentos", "cadastrado_em"];
  const lines = customers.map((c) =>
    [
      c.name,
      c.phoneE164,
      c.email,
      c.notes,
      c.tags.join("|"),
      (c.consentJson as Record<string, unknown>)?.whatsapp === true ? "sim" : "nao",
      c.appointments.filter((a) => a.status === "concluido").length,
      c.appointments.filter((a) => a.status === "nao_compareceu").length,
      c.appointments.filter((a) => a.status === "cancelado").length,
      c.createdAt.toISOString(),
    ]
      .map(cell)
      .join(","),
  );
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "customers.export", resource: `tenant:${user.tenantId}`, meta: { count: customers.length } });
  return new Response("﻿" + [header.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
