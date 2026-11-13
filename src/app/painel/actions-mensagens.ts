"use server";

import type { MessageEvent } from "@prisma/client";
import { requireTenantUser } from "@/lib/auth/session";
import { runAction, str, int } from "@/lib/actions";
import { saveMessageSettings, MESSAGE_INFO } from "@/lib/messages";
import { createCustomer, updateCustomer } from "@/lib/crm";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";

export async function saveMessagesAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/mensagens", async () => {
    await saveMessageSettings(tenant.id, user.id, {
      enabled: Object.fromEntries(MESSAGE_INFO.map((m) => [m.event, fd.get(`on_${m.event}`) === "on"])) as Record<MessageEvent, boolean>,
      reminderHours: str(fd, "reminderHours").split(/[,;\s]+/).filter(Boolean).map((x) => Number.parseInt(x, 10)),
      presenceRequestHours: int(fd, "presenceRequestHours", 24),
      presenceDeadlineHours: int(fd, "presenceDeadlineHours", 3),
      autoReleaseUnconfirmed: fd.get("autoReleaseUnconfirmed") === "on",
      waitlistEnabled: fd.get("waitlistEnabled") === "on",
      sendWindowStart: str(fd, "sendWindowStart") || "08:00",
      sendWindowEnd: str(fd, "sendWindowEnd") || "21:00",
    });
    return "Mensagens automáticas salvas";
  });
}

/** Novo cliente avulso (recepção / balcão). */
export async function createCustomerAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser({ permission: "viewCustomers" });
  let id: string | null = null;
  let error: string | null = null;
  try {
    const c = await createCustomer(
      tenant.id,
      {
        name: str(fd, "name"),
        phone: str(fd, "phone"),
        email: str(fd, "email") || null,
        notes: str(fd, "notes") || null,
        tags: str(fd, "tags").split(","),
        consentWhatsapp: fd.get("consent") === "on",
      },
      user.id,
    );
    id = c.id;
  } catch (e) {
    error = e instanceof AppError ? e.message : "Não foi possível cadastrar";
    if (!(e instanceof AppError)) console.error("[cliente]", e);
  }
  if (!id) redirect("/painel/clientes?erro=" + encodeURIComponent(error ?? "Erro"));
  redirect(`/painel/clientes/${id}?ok=` + encodeURIComponent("Cliente cadastrado"));
}

/** Edição completa na ficha, incluindo o telefone. */
export async function updateCustomerFullAction(customerId: string, fd: FormData) {
  const { user, tenant } = await requireTenantUser({ permission: "viewCustomers" });
  await runAction(`/painel/clientes/${customerId}`, async () => {
    await updateCustomer(
      tenant.id,
      customerId,
      {
        name: str(fd, "name"),
        email: str(fd, "email") || null,
        notes: str(fd, "notes") || null,
        tags: str(fd, "tags").split(","),
        phone: str(fd, "phone"),
      },
      user.id,
    );
    return "Cliente atualizado";
  });
}
