import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa de 32+ caracteres"),
  CREDENTIALS_KEY: z.string().optional().default(""),
  BRANDING_AI_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().default("dev-payment-webhook-secret"),
  WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(""),
  WHATSAPP_GRAPH_VERSION: z.string().default("v27.0"),
  STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".uploads"),
  JOBS_SECRET: z.string().default("dev-jobs-secret"),
  // Fase 2
  BILLING_PROVIDER: z.enum(["mock"]).default("mock"),
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
