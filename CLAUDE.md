# CLAUDE.md

Este arquivo orienta o Claude Code ao trabalhar neste repositório.

## Projeto

**Amser**: SaaS multi-tenant de agendamento para negócios de beleza (nail, sobrancelha, barbearia, salão). Ele se apoia em três pilares (spec §2): página com a cara da marca gerada por IA, sinal via Pix contra faltas e preço sem comissão com WhatsApp incluído. **Toda funcionalidade nova deve reforçar um pilar ou ser requisito básico de mercado.**

- Produto: [.doc/Amser_Especificacao_Claude_Code.md](.doc/Amser_Especificacao_Claude_Code.md) (v1.1) e [.doc/analise-concorrencia.md](.doc/analise-concorrencia.md)
- Técnico: [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/api.md](docs/api.md), [docs/tasks.md](docs/tasks.md) e [docs/adr/](docs/adr/)
- Fase atual: **Fases 1 e 2 implementadas** (pendências externas em [docs/tasks.md](docs/tasks.md)). Não implementar itens da Fase 3 sem aprovação. Registre decisões em ADR.

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind 4 · PostgreSQL 16 + Prisma 6 · Vitest · Railway. Não adicionar Redis, Supabase ou microsserviços sem necessidade comprovada.

## Comandos

```bash
docker compose up -d        # Postgres em localhost:5433
npm run db:deploy           # aplica migrations   (npm run db:migrate para criar novas)
npm run db:seed             # dados de demo (senha amser-dev-123)
npm run dev                 # app em :3000
npm run jobs:run -- --loop  # jobs (Pix, WhatsApp, prévias)
npm test                    # unit + integração (banco amser_test)
npm run lint                # tsc --noEmit
npm run build
```

## Regras que não podem ser quebradas

- **Isolamento**: acessar dados de negócio só via `tenantDb(tenantId)` (`src/lib/db.ts`). O `tenantId` vem da sessão, do slug resolvido no servidor ou de token assinado, **nunca** do corpo da requisição. O `prisma` cru só é usado em superadmin, jobs e webhooks, sempre filtrando `tenantId`.
- **Agenda**: a exclusion constraint `appointments_no_overlap` é a garantia final contra agendamento duplo. Não contorne. Remarcação é um único `UPDATE`.
- **Dinheiro** em centavos (int). **Instantes** em UTC (`timestamptz`), com horário de parede no fuso da unidade (`src/lib/time.ts`).
- **Integrações** (IA, PSP, cobrança, WhatsApp, Instagram) ficam atrás de interfaces com mock. Webhooks verificam assinatura e são idempotentes. Falha de WhatsApp nunca afeta a agenda (usar o outbox). Chamadas externas (Pix, reembolso) nunca dentro de transação do banco.
- **Dinheiro do sinal**: crédito, cupom e liquidação passam por `deposit-policy.ts` e `coupons.ts`. Reservas que expiram devolvem crédito e uso de cupom (`releaseExpiredSideEffects`).
- **IA**: a saída é dado não confiável (validar, sanitizar, corrigir contraste). Nunca inventar serviços, preços ou depoimentos. Publicar exige aprovação humana. Imagens só com direitos confirmados, sem scraping do Instagram.
- **Segredos**: nunca enviar tokens ou credenciais ao navegador; credenciais ficam criptografadas (`src/lib/crypto.ts`).
- **Migrations**: nunca editar uma já aplicada; crie uma nova.

## Convenções

- Idioma: português (BR) em UI, mensagens de erro, docs e commits. Código e identificadores em inglês.
- Erros de domínio via `AppError`/`Errors` (`src/lib/errors.ts`), com mensagem segura para o usuário.
- Server actions do painel usam `runAction()` (redirect com `?ok=`/`?erro=`).
- Toda regra nova de agenda, pagamento ou isolamento precisa de teste de integração em `tests/integration/`.
