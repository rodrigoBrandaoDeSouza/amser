# Tarefas — Fase 1 (MVP)

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente · 🔒 depende de decisão da Fase 0

## Entregue

| # | Item da spec (§3) | Status | Onde |
|---|---|---|---|
| 1 | Autenticação, multi-tenancy, painel superadmin | ✅ | `lib/auth`, `lib/db.ts`, `/admin` |
| 2 | Onboarding com upload + IA (revisão obrigatória) | ✅ | `lib/branding`, `/painel/marca`, `/admin/empresas/{id}` |
| 3 | Prévia para prospect (rascunho, token, expiração, conversão) | ✅ | `/admin/prospects/novo`, `/preview/{token}`, `lib/tenants.ts` |
| 4 | Editor de tema + página pública responsiva | ✅ | `/painel/marca`, `/{slug}`, `components/public` |
| 5 | Serviços, profissionais, horários, clientes, agendamentos | ✅ | `/painel/*` |
| 6 | Agenda administrativa + bloqueio de conflitos | ✅ | `/painel/agenda`, exclusion constraint |
| 7 | Sinal via Pix com reserva provisória e expiração | 🟡 | Fluxo completo com **provider mock**. PSP real 🔒 |
| 8 | WhatsApp Cloud API: confirmação, lembretes, presença, logs | ✅ | `lib/whatsapp`, `/painel/integracoes` |
| 9 | Dashboard com métricas de faltas + auditoria | ✅ | `/painel`, `lib/metrics.ts`, `audit_logs` |
| 10 | Teste de carga de pico | ⬜ | ver abaixo |

## Pendências antes de produção

- 🔒 **PSP real (Fase 0)**: implementar `PaymentProvider` (Mercado Pago / Asaas / Efí / Pagar.me), onboarding da conta do tenant em `/painel/integracoes`, conciliação periódica de cobranças sem webhook.
- 🔒 **Tabela de preços da Meta** para calcular `plans.message_quota`.
- ⬜ **Object storage (S3/R2)** em `lib/storage` — o disco do Railway é efêmero. Obrigatório antes do deploy.
- ⬜ **Teste de carga** (k6 ou autocannon) simulando sábado de manhã: N clientes consultando `availability` e reservando o mesmo dia. Medir p95 e confirmar zero duplicidades.
- ⬜ **Redução de imagens** antes da IA (ex.: `sharp`, máx. 1568px) — hoje limitamos a 5 MB por arquivo.
- ⬜ **Rate limit distribuído** se houver mais de uma instância (tabela no Postgres).
- ⬜ **MFA opcional e troca/recuperação de senha** (§17).
- ⬜ **E2E de navegador** (Playwright) do fluxo de reserva no celular.
- ⬜ **Templates da Meta**: submeter e aprovar `amser_booking_confirmed`, `amser_reminder`, etc. (variáveis em `/painel/integracoes`).
- ⬜ **Backups** do Postgres no Railway e política de retenção LGPD (exclusão/anonimização de clientes inativos).
- ⬜ **Importação CSV de clientes** e etiquetas editáveis no CRM (§10).

## Testes existentes

`npm test` — 37 testes (unitários + integração em Postgres real):
disponibilidade/fuso, sinal, contraste/sanitização do tema, criptografia, tokens; concorrência (8 reservas simultâneas), "qualquer profissional", buffer, Pix confirmado uma vez, webhook inválido, Pix expirado/pagamento tardio, retenção do sinal, remarcação atômica, isolamento entre tenants, retentativa do WhatsApp, lembrete de horário remarcado, consentimento, ciclo da prévia, versões do tema.
