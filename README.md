# Amser

SaaS multi-tenant de agendamento para negócios de beleza e bem-estar. Cada empresa tem uma página de agendamento com a cara da própria marca (tema gerado por IA a partir de fotos enviadas pelo dono), sinal via Pix para reduzir faltas e lembretes pelo WhatsApp oficial.

- Especificação: [.doc/Amser_Especificacao_Claude_Code.md](.doc/Amser_Especificacao_Claude_Code.md)
- Análise de concorrência: [.doc/analise-concorrencia.md](.doc/analise-concorrencia.md)
- Arquitetura, banco, API e pendências: [docs/](docs/)

## Stack

Next.js 15 (App Router, TypeScript, Tailwind 4) · PostgreSQL 16 + Prisma 6 · Vitest · Railway.

## Rodando localmente

Requisitos: Node 22+ e Docker.

```bash
npm install
cp .env.example .env            # gere SESSION_SECRET e CREDENTIALS_KEY (instruções no arquivo)
docker compose up -d            # Postgres em localhost:5433
npm run db:deploy               # aplica as migrations
npm run db:seed                 # dados de demonstração
npm run dev                     # http://localhost:3000
npm run jobs:run -- --loop      # (outro terminal) Pix expirado, WhatsApp, limpeza de prévias
```

O seed imprime os acessos (senha padrão `amser-dev-123`):

| Quem | Login | Para ver |
|---|---|---|
| Superadmin | `admin@amser.dev` | `/admin`: empresas, prévias de prospect |
| Studio Ana Nails (**com sinal Pix**) | `ana@studioana.dev` | `/studio-ana-nails` |
| Barbearia do João (sem sinal) | `joao@barbearia.dev` | `/barbearia-do-joao` |
| Prévia de prospect | — | link `/preview/…` impresso no seed |

Em dev, tudo roda com **mocks**: IA (`BRANDING_AI_PROVIDER=mock`), Pix (`PAYMENT_PROVIDER=mock`, com botão "[dev] Simular pagamento" na página do agendamento) e WhatsApp (`WHATSAPP_PROVIDER=mock`, mensagens aparecem no log).

Para usar o Claude na análise de marca: `BRANDING_AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY=…`.

### Fase 2 em dev

| Recurso | Como testar |
|---|---|
| Cadastro self-service | `/cadastro` |
| Cupom | `BEMVINDA10` no Studio Ana Nails (10%) |
| Lista de espera | Num dia sem horários, "Avise-me se abrir um horário"; cancele um agendamento e veja a mensagem `waitlist_offer` em Integrações |
| Crédito em vez de reembolso | Configurações → Política do sinal → "Crédito para o próximo agendamento" |
| Unidades | Painel → Unidades (o plano Essencial permite 1; troque para "Rede" no admin) |
| Assinatura | Painel → Plano. Rode os jobs perto do fim do teste para gerar a fatura; botão "[dev] Simular pagamento" |
| Instagram | `INSTAGRAM_PROVIDER=mock` → Marca → "importe fotos do seu Instagram" |
| Domínio próprio | Configurações → Domínio próprio. Para testar o roteamento local: `curl -H "Host: seu.dominio" localhost:3000/` após verificar |

## Testes

```bash
npm test               # unitários + integração (cria o banco amser_test automaticamente)
npm run lint           # checagem de tipos
```

Os testes de integração rodam contra Postgres real: concorrência de reservas, isolamento entre tenants, Pix (idempotência, expiração, pagamento tardio), remarcação atômica, outbox do WhatsApp e ciclo da prévia.

## Deploy (Railway)

1. Crie um projeto com dois serviços: **PostgreSQL** e esta aplicação (deploy do GitHub). O `railway.json` define build, migrations no start e healthcheck (`/api/health`).
2. Variáveis da aplicação: todas do `.env.example`, com `NODE_ENV=production`, `APP_URL` = domínio público, segredos fortes (`SESSION_SECRET`, `CREDENTIALS_KEY`, `JOBS_SECRET`, `PAYMENT_WEBHOOK_SECRET`) e `DATABASE_URL` referenciando o Postgres do projeto.
3. **Jobs:** agende `POST /api/jobs/run` com `Authorization: Bearer $JOBS_SECRET` a cada minuto (cron externo) ou crie um serviço cron no Railway executando `npm run jobs:run`. Confira o intervalo mínimo suportado pelo Railway. A expiração de Pix também acontece dentro da transação de reserva, então a correção da agenda não depende do cron, mas as mensagens do WhatsApp sim.
4. **Domínio próprio**: depois que o dono verificar o domínio no painel, adicione-o como *custom domain* no serviço do Railway (é o que emite o HTTPS). Para hosts extras do próprio Amser, use `APP_HOSTS`.
5. **Instagram**: app Meta do tipo Business, redirect URI `{APP_URL}/api/integrations/instagram/callback`, `INSTAGRAM_PROVIDER=meta`, `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`. Atender contas de clientes exige Advanced Access (App Review).
6. **Antes de produção**, veja [docs/tasks.md](docs/tasks.md): object storage (o disco do Railway é efêmero), PSPs reais (sinal e assinatura), templates aprovados na Meta e teste de carga.

## Estrutura

```
src/app/            rotas (página pública, painel, admin, APIs, webhooks)
src/components/     UI do painel e da página pública
src/lib/            domínio: agenda, pagamentos, whatsapp, branding, auth, jobs
prisma/             schema, migrations (inclui exclusion constraint) e seed
tests/              unitários e integração
docs/               arquitetura, banco, API, tarefas e ADRs
.doc/               especificação de produto e análise de mercado
```
