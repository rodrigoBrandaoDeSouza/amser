# Arquitetura — Amser (MVP / Fase 1)

Base: [especificação v1.1](../.doc/Amser_Especificacao_Claude_Code.md) §15. Decisões em [adr/](adr/).

## Visão geral

```
                    ┌──────────────────────────── Railway ────────────────────────────┐
 Cliente final ───▶ │  Next.js 15 (App Router, TS) — uma aplicação                   │
 (celular)          │   ├─ /{slug}            página pública (tema do tenant)        │
                    │   ├─ /a/{token}         gerir agendamento / pagar Pix          │
 Dono/equipe ─────▶ │   ├─ /painel/*          painel do proprietário (server actions)│
 Superadmin ──────▶ │   ├─ /admin/*           superadmin + prévias de prospect       │
                    │   ├─ /api/public/*      disponibilidade e reserva (JSON)       │
 PSP (Pix) ───────▶ │   ├─ /api/integrations/payments/{provider}/webhook             │
 Meta (WhatsApp) ─▶ │   ├─ /api/integrations/whatsapp/webhook                        │
 Cron Railway ────▶ │   └─ /api/jobs/run      (ou `npm run jobs:run`)                │
                    │                 │                                              │
                    │                 ▼                                              │
                    │  PostgreSQL (Prisma) — um banco, isolamento por tenant_id      │
                    └────────────────────────────────────────────────────────────────┘
        Saídas: Claude API (tema por IA) · Meta Cloud API (WhatsApp) · PSP (Pix) · object storage (mídia)
```

Sem Redis, filas externas ou microsserviços: o **outbox no Postgres** e um **cron simples** cobrem filas, retentativas e expirações.

## Camadas (`src/lib`)

| Módulo | Responsabilidade |
|---|---|
| `db.ts` | Prisma + `tenantDb(tenantId)`: extensão que injeta `tenant_id` em toda leitura/escrita e recusa modelos não-tenant. |
| `scheduling/` | `availability.ts` (função pura de horários), `booking.ts` (reserva transacional, remarcação atômica, cancelamento, fechamento), `deposit.ts`. |
| `payments/` | Interface `PaymentProvider` (mock hoje; PSP real na Fase 0) e `service.ts` (webhook idempotente). |
| `whatsapp/` | Interface `WhatsappProvider` (mock e Meta Cloud API) e `outbox.ts` (agendamento, envio, retentativa, franquia). |
| `branding/` | `theme.ts` (schema, contraste WCAG, sanitização), `analyze.ts` (mock e Claude multimodal), `service.ts` (rascunho → publicação → versões). |
| `jobs/` | Expira reservas, libera não confirmados, processa outbox, apaga prévias vencidas. |
| `auth/` | Sessão JWT em cookie httpOnly (jose) + bcrypt; `requireTenantUser` / `requireSuperadmin`. |
| `tokens.ts` | Links do cliente final (`/a/{token}`): JWT assinado, preso a agendamento + tenant, com expiração. |
| `crypto.ts` | AES-256-GCM para credenciais de integração; HMAC para webhooks. |

## Garantias principais

- **Sem agendamento duplo**: `EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, block_ends_at) WITH &&)` para status ativos. Corridas viram erro `23P01` → "horário acabou de ser reservado". Testado com 8 reservas simultâneas.
- **Remarcação atômica**: um único `UPDATE` do intervalo; se o novo conflitar, nada muda.
- **Reserva provisória do Pix**: `aguardando_sinal` + `hold_expires_at`. Reservas vencidas são expiradas *na mesma transação* antes de cada inserção (não depende do cron) e também pelo job.
- **Webhook de pagamento**: assinatura verificada → `webhook_events` (único por evento) → updates condicionais. Pagamento depois da expiração não "ressuscita" o horário; vira `needs_refund`.
- **WhatsApp nunca afeta a agenda**: a reserva só grava linhas no outbox; o envio é assíncrono com backoff exponencial (2^n min) e dead-letter após 5 tentativas. Reagendamentos invalidam lembretes antigos pela chave/horário.
- **Isolamento**: `tenantId` sempre do contexto autenticado (sessão), do slug resolvido no servidor ou do token assinado — nunca do corpo da requisição.
- **IA como dado não confiável**: saída validada por zod (structured outputs), textos sanitizados, contraste corrigido, imagens mapeadas só para IDs existentes; publicação exige aprovação humana.

## Fluxos

**Reserva pública**: `GET availability` → `POST appointments` (revalida slot no servidor, deduplica cliente por telefone, transação com exclusion constraint) → se há sinal, cria cobrança Pix e mostra `/a/{token}` com QR + polling → webhook confirma → mensagens enfileiradas.

**Prévia para prospect**: superadmin envia fotos (com confirmação de direitos) → tenant `prospect` + catálogo de exemplo + análise da IA → link `/preview/{token}` (noindex, 14 dias) → conversão mantém tema e mídias e desativa exemplos.

**Jobs** (a cada minuto): `expireHolds`, `releaseUnconfirmed`, `processOutbox`, `purgeExpiredProspects`.

## Limites conhecidos do MVP

Ver [tasks.md](tasks.md) — destaque: rate limit em memória (uma instância), storage local em dev (produção exige S3/R2), PSP real pendente da Fase 0.
