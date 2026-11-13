-- Fase 2: pagamentos retidos antes da retenção parcial passam a registrar o valor retido.
UPDATE "payments" SET "retained_cents" = "amount_cents" WHERE "status" = 'retained' AND "retained_cents" = 0;
-- Assinaturas: empresas existentes sem assinatura entram em trial no plano atual.
INSERT INTO "subscriptions" ("id", "tenant_id", "plan_id", "status", "period_start", "period_end", "trial_ends_at")
SELECT 'sub_' || substr(md5(random()::text || t.id), 1, 20), t.id, t.plan_id, 'trialing', now(), now() + interval '14 days', now() + interval '14 days'
FROM "tenants" t
WHERE t.plan_id IS NOT NULL AND t.status IN ('onboarding', 'active')
  AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s.tenant_id = t.id);
