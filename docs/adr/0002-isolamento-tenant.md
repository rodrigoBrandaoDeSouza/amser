# ADR 0002 — Isolamento por tenant via extensão do Prisma

**Status:** aceita · **Data:** 2026-11-13

**Contexto.** Um banco para todas as empresas (§4); vazamento entre tenants é o pior defeito possível.

**Decisão.** `tenantDb(tenantId)` (src/lib/db.ts) é uma extensão do Prisma que adiciona `tenantId` ao `where` de leituras/updates/deletes e ao `data` de criações, bloqueia troca de `tenantId` em updates e recusa modelos sem `tenant_id`. O `tenantId` vem só da sessão, do slug resolvido no servidor ou de token assinado. O cliente "cru" (`prisma`) fica restrito a superadmin, jobs globais e webhooks, e nesses pontos as queries filtram `tenantId` explicitamente.

**Alternativas.** Row Level Security no Postgres: mais forte, porém mais complexa com pool de conexões do Prisma. Reavaliar se o número de pontos com cliente cru crescer.

**Consequências.** Testes de integração cobrem leitura, update, cancelamento e reserva cruzados entre tenants.
