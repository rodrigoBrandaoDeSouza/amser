# ADR 0012 — Concorrência na agenda: exclusion constraint + advisory lock por profissional

**Status:** aceita · **Data:** 2026-11-13 · substitui parte do ADR 0001

**Problema encontrado (teste de estresse).** Com a exclusion constraint sozinha, duas inserções concorrentes no mesmo intervalo **entram em deadlock**: cada uma insere a linha e depois espera a outra transação para verificar o conflito. O Postgres só desfaz após `deadlock_timeout` (1 s), e as retentativas acumulavam até 20–27 s por reserva sob disputa. Também aparecia timeout de transação interativa do Prisma (P2028).

**Decisão.**
1. **Advisory lock por profissional** no início de toda transação que escreve na agenda (`pg_advisory_xact_lock(hashtextextended(professional_id, 0))`). As escritas de um mesmo profissional ficam em fila (milissegundos) e a segunda já vê o conflito, sem deadlock. Profissionais diferentes seguem em paralelo.
2. A **exclusion constraint continua** como garantia final (defesa em profundidade).
3. `withTxRetry` para erros transitórios (40P01, 40001, P2034, P2028). Em "qualquer profissional", passa para o próximo.

**Resultado.** Teste de estresse (12 rodadas × 8 reservas simultâneas) de 187 s para 7 s, sempre com exatamente 2 reservas por rodada. Teste de carga local (50 clientes, 25 s): 0 sobreposições, 0 erros 5xx.
