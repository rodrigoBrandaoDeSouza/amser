/** Roda uma vez quando o servidor sobe (não no build). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { productionProblems, env, depositsEnabled, billingEnabled, isLocalAppUrl } = await import("./lib/env");
  const problems = productionProblems();
  if (problems.length && isLocalAppUrl()) {
    // Build de produção rodando na máquina (E2E, carga): só avisa.
    console.warn(`[amser] build de produção LOCAL (APP_URL em localhost) — checagens só como aviso:\n - ${problems.join("\n - ")}`);
  } else if (problems.length) {
    console.error(`\n[amser] Configuração de produção inválida:\n - ${problems.join("\n - ")}\n`);
    throw new Error("Configuração de produção inválida (veja o log acima)");
  }
  const e = env();
  console.info(
    `[amser] produção — WhatsApp: ${e.WHATSAPP_PROVIDER}, sinal Pix: ${depositsEnabled() ? e.PAYMENT_PROVIDER : "desativado"}, ` +
      `cobrança: ${billingEnabled() ? e.BILLING_PROVIDER : "manual"}, fotos: ${e.STORAGE_PROVIDER}, e-mail: ${e.EMAIL_PROVIDER}`,
  );
}
