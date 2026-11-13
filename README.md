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
4. **Antes de produção**, veja [docs/tasks.md](docs/tasks.md): object storage (o disco do Railway é efêmero), PSP real, templates aprovados na Meta e teste de carga.

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
