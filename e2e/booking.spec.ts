import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI */
}
async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Fluxos críticos no navegador. Pré-requisito: `npm run db:seed`.
 * Cada teste usa um telefone diferente para não esbarrar no rate limit.
 */
const phone = () => `119${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

async function pickFirstSlot(page: Page) {
  // Procura o primeiro dia com horário (alguns dias podem estar sem expediente).
  for (let i = 0; i < 10; i++) {
    const slots = page.locator("button.pub-chip.tabular-nums");
    await page.getByText("Carregando horários…").waitFor({ state: "detached" }).catch(() => undefined);
    if ((await slots.count()) > 0) {
      await slots.first().click();
      return;
    }
    await page.getByRole("option").nth(i + 1).click();
  }
  throw new Error("nenhum horário encontrado em 10 dias");
}

test("reserva sem sinal na barbearia (até 5 passos) e gestão do agendamento", async ({ page }, info) => {
  await page.goto("/barbearia-do-joao");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: `test-results/telas/${info.project.name}-pagina-publica.png`, fullPage: true });

  await page.getByRole("button", { name: /Corte \+ barba/ }).click();
  await page.getByRole("button", { name: "Qualquer profissional disponível" }).click();
  await pickFirstSlot(page);
  await page.getByLabel("Seu nome").fill("Teste E2E");
  await page.getByLabel("WhatsApp (com DDD)").fill(phone());
  await page.screenshot({ path: `test-results/telas/${info.project.name}-dados.png`, fullPage: true });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();

  await expect(page).toHaveURL(/\/a\//);
  await expect(page.getByRole("status").first()).toContainText("Agendado");
  await page.screenshot({ path: `test-results/telas/${info.project.name}-agendado.png`, fullPage: true });
  await page.getByRole("button", { name: "Confirmar presença" }).click();
  await expect(page.getByText("Presença confirmada")).toBeVisible();
});

test("reserva com sinal Pix no Studio Ana, cupom e pagamento simulado", async ({ page }, info) => {
  await page.goto("/studio-ana-nails");
  await page.getByRole("button", { name: /Manicure/ }).click();
  await pickFirstSlot(page);
  await page.getByLabel("Seu nome").fill("Cliente Pix");
  await page.getByLabel("WhatsApp (com DDD)").fill(phone());
  await page.getByLabel("Código do cupom").fill("BEMVINDA10");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText(/Cupom BEMVINDA10/)).toBeVisible();
  await page.getByRole("button", { name: /Reservar e pagar sinal/ }).click();

  await expect(page).toHaveURL(/\/a\//);
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  await page.screenshot({ path: `test-results/telas/${info.project.name}-pix.png`, fullPage: true });
  // O "PSP" confirma o Pix pelo webhook assinado — como em produção.
  const token = page.url().split("/a/")[1];
  const appt = await withDb((db) =>
    db.appointment.findFirstOrThrow({ where: { status: "aguardando_sinal" }, orderBy: { createdAt: "desc" }, include: { payments: true } }),
  );
  expect(appt.depositAmountSnapshotCents).toBe(1080); // 30% de R$ 36,00 (R$ 40,00 − 10%)
  const body = JSON.stringify({ id: `evt_e2e_${Date.now()}`, chargeId: appt.payments[0].providerChargeId, status: "paid" });
  const sig = crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET ?? "dev-payment-webhook-secret").update(body).digest("hex");
  const res = await page.request.post("/api/integrations/payments/mock/webhook", { data: body, headers: { "x-amser-signature": sig, "content-type": "application/json" } });
  expect((await res.json()).outcome).toBe("confirmed");
  expect(token.length).toBeGreaterThan(20);
  await expect(page.getByRole("status").first()).toContainText("Confirmado", { timeout: 20_000 }); // polling da página
});

test("painel do dono: login, agenda, semana e relatórios", async ({ page }, info) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("joao@barbearia.dev");
  await page.getByLabel("Senha").fill("amser-dev-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/painel/);
  await page.screenshot({ path: `test-results/telas/${info.project.name}-painel.png`, fullPage: true });
  await page.goto("/painel/agenda?visao=semana");
  await expect(page.getByRole("heading", { name: "Semana" })).toBeVisible();
  await page.screenshot({ path: `test-results/telas/${info.project.name}-semana.png`, fullPage: true });
  await page.goto("/painel/relatorios");
  await expect(page.getByText("Faturamento estimado", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/telas/${info.project.name}-relatorios.png`, fullPage: true });
  await page.goto("/painel/marca");
  await page.screenshot({ path: `test-results/telas/${info.project.name}-marca.png`, fullPage: true });
});
