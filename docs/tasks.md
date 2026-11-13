# Tarefas e status

Legenda: ✅ feito · 🟡 feito com provider simulado / depende de terceiro · 🔒 depende de decisão sua · ⬜ pendente

## Fase 1 (MVP)

| Item | Status |
|---|---|
| Autenticação, multi-tenancy, superadmin | ✅ (+ MFA, redefinição de senha, verificação de e-mail) |
| Onboarding com upload + IA (revisão obrigatória) | ✅ (IA real só com `ANTHROPIC_API_KEY`) |
| Prévia para prospect | ✅ |
| Editor de tema + página pública | ✅ |
| Serviços, profissionais, horários, clientes, agendamentos | ✅ |
| Agenda (dia e semana) + bloqueio de conflitos | ✅ (advisory lock + exclusion constraint, ADR 0012) |
| Sinal via Pix | 🟡 provider simulado (🔒 PSP real) |
| WhatsApp Cloud API oficial | ✅ (conexão validada, templates, webhook, respostas rápidas, opt-out — ADR 0011) |
| Dashboard de faltas + auditoria | ✅ |
| Teste de carga de pico | ✅ `npm run load-test` (resultado abaixo) |

## Fase 2

| Item | Status |
|---|---|
| Lista de espera | ✅ |
| Política de sinal (reembolso/crédito/retenção parcial) | 🟡 reembolso simulado (🔒 PSP) |
| Cupons, múltiplas unidades, limites de plano | ✅ |
| Domínio próprio | 🟡 HTTPS precisa ser adicionado no Railway (manual) |
| Assinatura do SaaS | 🟡 cobrança simulada (🔒 PSP de cobrança) |
| Instagram Login + importação | 🟡 exige App Review da Meta |
| Cadastro self-service | ✅ (+ verificação de e-mail) |

## Itens da spec que estavam faltando — entregues

- CRM: ficha do cliente, etiquetas, observações, importação CSV, consentimento pelo painel.
- LGPD: exportação por cliente, anonimização e retenção automática (ADR 0014).
- Relatórios por período, serviço e profissional, com CSV; agenda semanal.
- Permissões configuráveis da equipe.
- Superadmin: acesso de suporte autorizado pelo dono, exclusão programada, feature flags (global e por empresa).
- MFA opcional; redefinição de senha; troca de senha encerra sessões (ADR 0013).
- Storage S3/R2 e otimização de imagens (1600 px, WebP, sem EXIF/GPS).
- Docker: `docker compose --profile app up --build` (app + jobs + Postgres).
- E2E no navegador (Playwright, celular e desktop) com verificação visual das telas.

## Pendências

- 🔒 **PSP** para Pix do sinal, reembolso automático e cobrança da assinatura (interfaces prontas: `PaymentProvider`, `BillingProvider`).
- 🔒 **Provedor de e-mail** em produção (qualquer SMTP: SES, Resend, Postmark, Brevo…).
- 🔒 **Bucket** S3 ou R2 (o código suporta os dois).
- ⬜ **Templates do WhatsApp:** criar pelo painel e aguardar a aprovação da Meta. No primeiro envio real, conferir o formato do webhook de resposta rápida.
- ⬜ **Meta:** App Review para o Instagram; Embedded Signup do WhatsApp, que exige ser Tech Provider.
- ⬜ **Dependências com versão maior pendente:** Next 15 → 16 (corrige alerta do `postcss` embutido) e Prisma 6 → 7 (alerta do `deepmerge-ts`). São alertas de ferramentas de build, mas devem ser atualizados com teste dedicado.
- ⬜ **IA real:** rodar `BRANDING_AI_PROVIDER=anthropic` com fotos reais e avaliar a qualidade e o custo por análise.
- ⬜ **MFA:** códigos de recuperação e bloqueio de reutilização do mesmo código.
- ⬜ **Escala horizontal:** o rate limit é em memória; com mais de uma instância, mover para o Postgres.
- ⬜ **Backups** do Postgres no Railway (configuração da plataforma).

## Testes

- `npm test`: 87 testes (unitários + integração em Postgres real), incluindo estresse de concorrência.
- `npm run test:e2e`: 6 cenários no Chromium (celular e desktop). Rodam contra o build de produção; precisam de `npm run build` e do seed.
- `npm run load-test -- --url … --clientes 50 --segundos 25`.

### Resultado do teste de carga (local, 13/11/2026)

Máquina de desenvolvimento Windows, Next numa instância e Postgres no Docker Desktop, com 50 clientes em laço contínuo, sem pausa:

| Rota | n | p50 | p95 | p99 |
|---|---|---|---|---|
| Página pública | 945 | 634 ms | 1008 ms | 1312 ms |
| Disponibilidade | 945 | 426 ms | 635 ms | 708 ms |
| Reserva (disputa pelos mesmos horários) | 199 | 1070 ms | 2509 ms | 4204 ms |

82 req/s, **0 sobreposições, 0 erros 5xx**; 186 tentativas recusadas corretamente com 409 (horário já ocupado). A latência reflete o ambiente local e a carga sem pausa. Repetir no Railway antes do lançamento.

## Ajustes de usabilidade (13/11/2026)

- **Mensagens automáticas** (`/painel/mensagens`): um lugar só para ligar e desligar cada mensagem, com prévia no estilo do WhatsApp, status na Meta, horários dos lembretes e da confirmação de presença, janela de envio e lista de espera. Desligar cancela também as mensagens que já estavam na fila. Essas opções saíram de Configurações e de Integrações.
- **Superadmin**: na ficha da empresa, conecta o WhatsApp (validação na Meta) e cria e sincroniza os templates. Serve para o onboarding feito pela equipe.
- **Clientes**: botão "Novo cliente" (cadastro avulso com registro de consentimento) e troca de telefone na ficha. A troca é recusada se o número for de outro cliente; as mensagens na fila passam para o número novo.
