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

# Fase 2

| Item | Status | Onde |
|---|---|---|
| Lista de espera com oferta automática | ✅ | `lib/waitlist.ts`, `/w/{token}`, `/painel/lista-de-espera` |
| Política de sinal: reembolso automático, crédito, retenção parcial | 🟡 | `lib/scheduling/deposit-policy.ts`. Reembolso só no PSP mock 🔒 |
| Cupons | ✅ | `lib/coupons.ts`, `/painel/cupons`, campo na reserva |
| Múltiplas unidades + limites do plano | ✅ | `/painel/unidades`, escolha de unidade na página, filtro na agenda, `lib/plans.ts` |
| Domínio próprio | 🟡 | `lib/domains.ts`, `middleware.ts`, `/d/{host}`. HTTPS no Railway manual ⬜ |
| Assinatura do SaaS (trial, fatura, inadimplência, suspensão) | 🟡 | `lib/billing/`, `/painel/plano`. PSP de cobrança mock 🔒 |
| Instagram Login + importação | 🟡 | `lib/instagram/`, `/painel/marca/instagram`. App Review da Meta 🔒 |
| Cadastro self-service | 🟡 | `/cadastro`. Falta verificação de e-mail ⬜ |

Pendências da Fase 2:
- 🔒 PSP de cobrança da assinatura (`BillingProvider`) e reembolso real (`PaymentProvider.refund`).
- 🔒 App da Meta do tipo Business + Advanced Access para `instagram_business_basic`; template do WhatsApp `waitlist_offer` com botão `/w/{{1}}`.
- ⬜ Automatizar o cadastro do domínio verificado no Railway (API) para emitir HTTPS.
- ⬜ Verificação de e-mail e recuperação de senha no cadastro self-service (exige provedor de e-mail).
- ⬜ Verificação por código no WhatsApp antes de usar crédito (ver ADR 0007).

## Testes existentes

`npm test`: 57 testes (unitários + integração em Postgres real).
- **Fase 1**: disponibilidade/fuso, sinal, contraste/sanitização do tema, criptografia, tokens; concorrência (8 reservas simultâneas), "qualquer profissional", buffer, Pix confirmado uma vez, webhook inválido, Pix expirado/pagamento tardio, retenção do sinal, remarcação atômica, isolamento entre tenants, retentativa do WhatsApp, lembrete de horário remarcado, consentimento, ciclo da prévia, versões do tema.
- **Fase 2**:
  - cupons: desconto e sinal, limite sob concorrência, devolução do uso, isolamento;
  - crédito: total, parcial e devolução na expiração;
  - reembolso automático com falha e nova tentativa; retenção parcial em cancelamento tardio e em falta;
  - lista de espera: oferta, reserva pelo link, limites e datas;
  - unidades com fuso próprio e limites do plano;
  - ciclo completo da assinatura; suspensão pelo admin não é revertida por pagamento;
  - domínio verificado por TXT;
  - Instagram: OAuth, importação e anti-SSRF;
  - cadastro self-service.
