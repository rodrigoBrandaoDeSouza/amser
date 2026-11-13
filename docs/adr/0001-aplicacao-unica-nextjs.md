# ADR 0001 — Aplicação única Next.js + PostgreSQL (Railway)

**Status:** aceita (spec §15) · **Data:** 2026-11-13

**Contexto.** MVP de baixo custo, time pequeno, um único deploy.

**Decisão.** Next.js 15 (App Router, TypeScript, Tailwind 4) full-stack; PostgreSQL com Prisma 6; Railway com app e banco em serviços separados. Painel usa server actions; rotas JSON só para a página pública e integrações. Sem Redis, filas externas ou microsserviços: outbox no Postgres + cron.

**Consequências.** Deploy e operação simples. Rate limit em memória exige atenção ao escalar horizontalmente (ver tasks.md).
