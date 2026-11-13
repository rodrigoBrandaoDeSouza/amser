// Carrega .env e aponta o Prisma para o banco de testes.
try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: usa variáveis do ambiente (CI) */
}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BRANDING_AI_PROVIDER = "mock";
process.env.PAYMENT_PROVIDER = "mock";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.STORAGE_LOCAL_DIR = ".uploads-test";
