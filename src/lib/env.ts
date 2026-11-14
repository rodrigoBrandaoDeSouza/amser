import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa de 32+ caracteres"),
  CREDENTIALS_KEY: z.string().optional().default(""),
  BRANDING_AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  PAYMENT_PROVIDER: z.enum(["none", "mock"]).default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().default("dev-payment-webhook-secret"),
  WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_GRAPH_VERSION: z.string().default("v27.0"),
  // Cadastro integrado da Meta (Embedded Signup, ADR 0015). Públicos (vão ao navegador): ID do app e
  // ID da configuração do "Login do Facebook para Empresas". O App Secret continua só no servidor.
  WHATSAPP_APP_ID: z.string().optional().default(""),
  WHATSAPP_ES_CONFIG_ID: z.string().optional().default(""),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".uploads"),
  // S3 ou Cloudflare R2 (R2: S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com, S3_REGION=auto)
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_PREFIX: z.string().optional().default(""),
  // E-mail (redefinição de senha, verificação): "console" (dev) ou "smtp"
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("Amser <nao-responda@amser.local>"),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  JOBS_SECRET: z.string().default("dev-jobs-secret"),
  // Fase 2
  BILLING_PROVIDER: z.enum(["none", "mock"]).default("mock"),
  BILLING_WEBHOOK_SECRET: z.string().default("dev-billing-webhook-secret"),
  INSTAGRAM_PROVIDER: z.enum(["off", "mock", "meta"]).default("off"),
  INSTAGRAM_APP_ID: z.string().optional().default(""),
  INSTAGRAM_APP_SECRET: z.string().optional().default(""),
  INSTAGRAM_GRAPH_VERSION: z.string().default("v27.0"),
  SELF_SIGNUP_ENABLED: z.enum(["true", "false"]).default("true"),
  DEFAULT_PLAN_NAME: z.string().default("Essencial"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        "Variáveis de ambiente inválidas: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";

/**
 * Sinal via Pix ligado? Sem PSP real ("none"), o sinal fica desativado e as
 * reservas são confirmadas sem pagamento. Em produção, o mock NUNCA é usado
 * (geraria um Pix impagável): equivale a "none".
 */
export function depositsEnabled(): boolean {
  const p = env().PAYMENT_PROVIDER;
  return p !== "none" && !(isProd() && p === "mock" && !isLocalAppUrl());
}

/** Cobrança automática da assinatura ligada? Mesmo critério: mock em produção = desligada (cobrança manual). */
export function billingEnabled(): boolean {
  const p = env().BILLING_PROVIDER;
  return p !== "none" && !(isProd() && p === "mock" && !isLocalAppUrl());
}

/** Build de produção rodando na máquina (testes E2E/carga): APP_URL em localhost. */
export function isLocalAppUrl(): boolean {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(env().APP_URL).hostname);
  } catch {
    return false;
  }
}

/**
 * Checagem de produção (rodada ao subir o servidor, não no build): falha
 * rápido com mensagem clara em vez de funcionar errado.
 */
export function productionProblems(): string[] {
  const e = env();
  const p: string[] = [];
  if (!e.APP_URL.startsWith("https://")) p.push("APP_URL precisa ser https:// em produção");
  if (/troque|gere-com|build-only|dev-/i.test(e.SESSION_SECRET)) p.push("SESSION_SECRET parece ser um valor de exemplo — gere um aleatório");
  if (Buffer.from(e.CREDENTIALS_KEY, "base64").length !== 32) p.push("CREDENTIALS_KEY deve ter 32 bytes em base64");
  if (/^dev-|gere-com/.test(e.JOBS_SECRET)) p.push("JOBS_SECRET parece ser um valor de exemplo");
  if (e.WHATSAPP_PROVIDER === "meta") {
    if (!e.WHATSAPP_APP_SECRET) p.push("WHATSAPP_APP_SECRET é obrigatório com WHATSAPP_PROVIDER=meta");
    if (!e.WHATSAPP_VERIFY_TOKEN || e.WHATSAPP_VERIFY_TOKEN.length < 16) p.push("WHATSAPP_VERIFY_TOKEN deve ter 16+ caracteres");
    if (!!e.WHATSAPP_APP_ID !== !!e.WHATSAPP_ES_CONFIG_ID) p.push("WHATSAPP_APP_ID e WHATSAPP_ES_CONFIG_ID precisam ser definidos juntos (cadastro integrado)");
  }
  // Caminho absoluto (Linux "/data/…" ou Windows "C:\…"); sem node:path para compilar também no edge.
  if (e.STORAGE_PROVIDER === "local" && !/^(\/|[A-Za-z]:[\\/])/.test(e.STORAGE_LOCAL_DIR)) {
    p.push("Em produção, STORAGE_LOCAL_DIR deve apontar para um volume persistente (ex.: /data/uploads) ou use STORAGE_PROVIDER=s3");
  }
  return p;
}

/** Só para testes: força reler as variáveis de ambiente. */
export function resetEnvCacheForTests() {
  cached = null;
}

/** Botão "Conectar meu WhatsApp" (cadastro integrado da Meta) disponível? No mock, sempre (simulado). */
export function embeddedSignupEnabled(): boolean {
  const e = env();
  return e.WHATSAPP_PROVIDER === "mock" || (!!e.WHATSAPP_APP_ID && !!e.WHATSAPP_ES_CONFIG_ID);
}
