"use server";

import { revalidatePath } from "next/cache";
import { requireTenantUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export type EmbeddedSignupResult = { ok: true; message: string; warnings: string[] } | { ok: false; error: string };

/**
 * Conclusão do cadastro integrado da Meta ("Conectar meu WhatsApp"). Só o dono.
 * O tenant vem da sessão; do navegador chegam apenas o código (30 s) e os IDs que a Meta devolveu.
 */
export async function embeddedSignupAction(input: {
  code: string;
  event: string;
  phoneNumberId: string;
  wabaId: string;
  businessId?: string | null;
}): Promise<EmbeddedSignupResult> {
  const { user, tenant } = await requireTenantUser();
  try {
    const { completeEmbeddedSignup } = await import("@/lib/whatsapp/service");
    const r = await completeEmbeddedSignup(tenant.id, user.id, {
      code: String(input.code ?? ""),
      event: String(input.event ?? ""),
      phoneNumberId: String(input.phoneNumberId ?? ""),
      wabaId: String(input.wabaId ?? ""),
      businessId: input.businessId ? String(input.businessId) : null,
    });
    revalidatePath("/painel/integracoes");
    const name = r.info?.verifiedName ? ` (${r.info.verifiedName} · ${r.info.displayPhoneNumber})` : "";
    return {
      ok: true,
      message: r.coexistence
        ? `WhatsApp conectado${name}. O número continua funcionando no app WhatsApp Business.`
        : `WhatsApp conectado${name}.`,
      warnings: r.warnings,
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error("[embedded-signup]", e);
    return { ok: false, error: "Algo deu errado ao conectar. Tente novamente." };
  }
}
