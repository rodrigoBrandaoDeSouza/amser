/**
 * Executa os jobs uma vez (expiração de Pix, liberação de horários, envio do
 * outbox do WhatsApp e limpeza de prévias). Use em cron (Railway) a cada minuto,
 * ou rode em loop no dev:  npm run jobs:run -- --loop
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* variáveis já no ambiente */
}

const { runAllJobs } = await import("../src/lib/jobs/index");
const { prisma } = await import("../src/lib/db");

const loop = process.argv.includes("--loop");
do {
  const started = Date.now();
  try {
    const r = await runAllJobs();
    console.log(new Date().toISOString(), JSON.stringify(r), `${Date.now() - started}ms`);
  } catch (e) {
    console.error("[jobs] erro", e);
  }
  if (loop) await new Promise((r) => setTimeout(r, 30_000));
} while (loop);

await prisma.$disconnect();
export {};
