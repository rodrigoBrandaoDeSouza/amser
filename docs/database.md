# Banco de dados

Fonte da verdade: [prisma/schema.prisma](../prisma/schema.prisma). Migrations em [prisma/migrations/](../prisma/migrations/).

## Convenções

- Tabelas e colunas em `snake_case`; IDs `cuid`.
- Instantes em `timestamptz` (UTC). Horário de parede (`working_hours.start_time`) é `"HH:MM"` no fuso da unidade.
- Dinheiro em **centavos** (`int`).
- Toda entidade de negócio tem `tenant_id` e é acessada via `tenantDb()` (exceções documentadas em `src/lib/db.ts`).

## Tabelas

| Tabela | Notas |
|---|---|
| `tenants` | Status `prospect → onboarding → active` (+ `suspended`, `deleted`). Políticas de agenda/sinal/presença. `preview_token` + `preview_expires_at` para prospects. |
| `tenant_branding` | `theme_json` validado por `ThemeSchema`. Versões (`version` único por tenant); uma `published`. |
| `tenant_media` | `kind` (`logo`/`photo`), `rights_confirmed` obrigatório, `storage_key` no object storage. |
| `units` | MVP usa uma ("Principal"), modelo já suporta várias. |
| `users` | `role`: `superadmin` (sem tenant), `owner`, `staff` (vinculado a um profissional). |
| `professionals`, `service_professionals`, `working_hours`, `schedule_exceptions` | Exceção com `professional_id` nulo vale para todos (feriado). |
| `services` | `deposit_type` (`none`/`percent`/`fixed`) + `deposit_value` (percentual ou centavos). |
| `customers` | Único por `(tenant_id, phone_e164)`. `consent_json.whatsapp` = opt-in. |
| `appointments` | `block_ends_at = ends_at + buffer`. `hold_expires_at` (Pix), `presence_deadline_at`, `confirmed_presence_at`. Snapshots de preço e sinal. |
| `appointment_events` | Histórico (created, deposit_paid, rescheduled, cancelled, presence_confirmed, hold_expired, auto_released, concluido, nao_compareceu). |
| `payments` | `provider_charge_id` único. Status `pending → paid → applied/retained/refunded` ou `expired`. `needs_refund` para reembolso manual. |
| `webhook_events` | Idempotência: único por `(provider, external_id)`. |
| `whatsapp_connections` | Uma por tenant; `encrypted_credentials` (AES-GCM); janela de envio. |
| `message_templates` | Nome do template aprovado na Meta por evento. |
| `message_outbox` | `idempotency_key` única; `status`, `attempts`, `scheduled_at`, `provider_message_id`. |
| `message_usage` | Contagem mensal × franquia do plano. |
| `plans`, `subscriptions` | Cobrança automatizada fica para a Fase 2. |
| `audit_logs` | Ações administrativas e sensíveis (sem dados pessoais completos). |

## Restrições que não aparecem no schema Prisma

Adicionadas em SQL na migration `init`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, block_ends_at, '[)') WITH &&)
  WHERE (status IN ('aguardando_sinal','pendente','confirmado'));
ALTER TABLE appointments ADD CONSTRAINT appointments_valid_range
  CHECK (starts_at < ends_at AND ends_at <= block_ends_at);
```

## Estados do agendamento

```
            (com sinal)                     webhook pago
 reserva ─────────────▶ aguardando_sinal ───────────────▶ confirmado ──▶ concluido
    │                        │ expira (hold)                  ▲   │──▶ nao_compareceu
    │ (sem sinal)            ▼                                │   └──▶ cancelado
    └──────────────▶ pendente ─── cliente confirma presença ──┘
                        │── sem confirmação + auto-release ──▶ cancelado
                        └──────────────────────────────────▶ cancelado / concluido / nao_compareceu
                     expirado  (horário liberado)
```

## Migrations

- Dev: `npm run db:migrate` (cria e aplica). Produção: `npm run db:deploy`.
- Nunca editar uma migration já aplicada; criar uma nova.

## Fase 2 (migrations `fase2` e `fase2_backfill`)

| Tabela / campo | Notas |
|---|---|
| `tenants.deposit_refund_mode`, `late_cancel_retain_percent`, `no_show_retain_percent`, `waitlist_enabled` | Política de sinal e lista de espera. |
| `tenants.suspended_reason`, `status_before_suspension` | Suspensão por cobrança é reversível pelo pagamento; por admin, não. |
| `units.active`, `phone`, `sort_order` | Múltiplas unidades. |
| `appointments.coupon_id`, `discount_cents`, `credit_applied_cents` | `price_snapshot_cents` já é o preço com desconto. |
| `payments.retained_cents`, `refunded_cents`, `credited_cents`, `provider_refund_id`; status `credited` | Liquidação parcial do sinal. |
| `coupons` | Único por `(tenant_id, code)`. `redemptions_count` atualizado com `UPDATE … WHERE redemptions_count < max_redemptions` (atômico). |
| `customer_credits` | Razão (positivo = crédito, negativo = uso). Saldo = soma. |
| `waitlist_entries` | `date` local; status `waiting → offered → booked/expired/cancelled`; `offers_count` ≤ 3. |
| `subscriptions.trial_ends_at`, `grace_until`, `canceled_at` | Ciclo de cobrança. |
| `billing_invoices` | Uma por `(subscription_id, period_start)`; `provider_charge_id` único. |
| `tenant_domains` | `hostname` único global; `verified_at` após o TXT. |
| `instagram_connections` | Uma por tenant; token criptografado; `token_expires_at` (60 dias). |
| `MessageEvent.waitlist_offer` | Novo evento do outbox. |

## Completo (migration `completo`)

| Tabela / campo | Notas |
|---|---|
| `whatsapp_connections.waba_id`, `verified_name`, `quality_rating`, `last_checked_at`, `last_error` | Conexão validada na Meta. |
| `message_templates.status`, `category`, `rejected_reason`, `meta_template_id`, `last_synced_at` | Só `APPROVED` é enviado. |
| `customers.whatsapp_user_id` (BSUID), `opted_out_at`, `anonymized_at` | Opt-out e LGPD. Anonimizado: telefone vira `anon:<id>`. |
| `users.email_verified_at`, `mfa_secret_encrypted`, `mfa_enabled_at`, `permissions_json`, `sessions_valid_after` | Conta, MFA, permissões da equipe. |
| `tenants.retention_months`, `deletion_scheduled_at`, `support_access_until` | LGPD e operação. |
| `auth_tokens` | Tokens de e-mail de uso único (só o hash). |
| `feature_flags` | `(key, scope)` único; scope = `global` ou id do tenant. |

**Concorrência:** além da exclusion constraint, toda escrita de agenda pega `pg_advisory_xact_lock(hashtextextended(professional_id, 0))` (ADR 0012).
