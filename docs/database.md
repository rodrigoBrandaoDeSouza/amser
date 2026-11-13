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
