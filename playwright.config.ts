import { defineConfig, devices } from "@playwright/test";

/**
 * E2E no navegador (Chromium) contra o BUILD DE PRODUÇÃO (em modo dev o Next
 * recompila e recarrega a página no meio do teste). Usa os dados do seed
 * (npm run db:seed) e providers mock; o Pix é confirmado pelo webhook assinado.
 */
const PORT = 3006;
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: true,
    env: { APP_URL: `http://localhost:${PORT}`, INSTAGRAM_PROVIDER: "mock" },
  },
});
