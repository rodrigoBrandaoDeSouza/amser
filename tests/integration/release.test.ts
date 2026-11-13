import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/scheduling/booking";
import { getPublicCatalog, cancellationPolicy } from "@/lib/public";
import { registerManualPayment, runBillingCycle, startTrial } from "@/lib/billing/service";
import { depositsEnabled, billingEnabled, productionProblems, resetEnvCacheForTests } from "@/lib/env";
import { NOW, at, customer, makeTenant, resetDb } from "./helpers";

const saved = { ...process.env };
function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCacheForTests();
}

beforeEach(resetDb);
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetEnvCacheForTests();
});

describe("versão 1.0 sem provedor de Pix", () => {
  it("PAYMENT_PROVIDER=none: reserva confirma sem sinal, catálogo mostra sinal 0 e política sem sinal", async () => {
    setEnv({ PAYMENT_PROVIDER: "none" });
    expect(depositsEnabled()).toBe(false);
    const T = await makeTenant({ deposit: { type: "percent", value: 30 } });
    const r = await createBooking({ tenant: T.tenant, serviceId: T.service.id, professionalId: null, startsAt: at("10:00").toISOString(), customer: customer(), source: "public", now: NOW });
    expect(r.appointment.status).toBe("pendente");
    expect(r.payment).toBeNull();
    expect(await prisma.payment.count()).toBe(0);
    expect((await getPublicCatalog(T.tenant.id))[0].depositCents).toBe(0);
    expect(cancellationPolicy(T.tenant)).not.toContain("sinal");
  });

  it("em produção, o mock de Pix e de cobrança nunca é usado", () => {
    setEnv({ NODE_ENV: "production", APP_URL: "https://amser.com.br", PAYMENT_PROVIDER: "mock", BILLING_PROVIDER: "mock" });
    expect(depositsEnabled()).toBe(false);
    expect(billingEnabled()).toBe(false);
  });

  it("cobrança manual: o ciclo automático não gera fatura nem suspende; o admin registra o pagamento", async () => {
    setEnv({ BILLING_PROVIDER: "none" });
    const T = await makeTenant();
    const plan = await prisma.plan.create({ data: { name: "Essencial", priceCents: 5990 } });
    const sub = await startTrial(prisma, T.tenant.id, plan.id, new Date("2030-01-01T12:00:00Z"));
    const r = await runBillingCycle(new Date(sub.periodEnd.getTime() + 30 * 86400_000));
    expect(r).toEqual({ invoices: 0, pastDue: 0, suspended: 0 });
    expect(await prisma.billingInvoice.count()).toBe(0);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("active");
    const until = await registerManualPayment(T.tenant.id, "admin", new Date("2030-01-20T12:00:00Z"));
    const s = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(s.status).toBe("active");
    expect(s.periodEnd.toISOString()).toBe(until.toISOString());
  });
});

describe("checagem de produção", () => {
  it("aponta configuração insegura ou incompleta", () => {
    setEnv({
      APP_URL: "http://amser.com.br",
      SESSION_SECRET: "troque-por-um-segredo-longo-e-aleatorio-123456",
      CREDENTIALS_KEY: "curta",
      WHATSAPP_PROVIDER: "meta",
      WHATSAPP_APP_SECRET: "",
      WHATSAPP_VERIFY_TOKEN: "x",
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_DIR: ".uploads",
      JOBS_SECRET: "dev-jobs-secret",
    });
    const p = productionProblems().join(" | ");
    for (const s of ["APP_URL", "SESSION_SECRET", "CREDENTIALS_KEY", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "STORAGE_LOCAL_DIR", "JOBS_SECRET"]) expect(p).toContain(s);
  });
  it("configuração correta passa", () => {
    setEnv({
      APP_URL: "https://amser.com.br",
      SESSION_SECRET: "a".repeat(20) + "b".repeat(30),
      CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
      WHATSAPP_PROVIDER: "meta",
      WHATSAPP_APP_SECRET: "segredo-do-app",
      WHATSAPP_VERIFY_TOKEN: "token-de-verificacao-longo",
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_DIR: "/data/uploads",
      JOBS_SECRET: "segredo-dos-jobs-aleatorio",
    });
    expect(productionProblems()).toEqual([]);
  });
});
