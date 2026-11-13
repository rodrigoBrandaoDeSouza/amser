# ADR 0007 — Política de sinal: reembolso, crédito e retenção parcial

**Status:** aceita · **Data:** 2026-11-13 · **Pilar:** 2

**Decisão.** Cada tenant escolhe como devolver o sinal (`refund` = reembolso automático no PSP; `credit` = crédito para o próximo agendamento) e quanto reter em cancelamento tardio e em falta (0–100%). O crédito é um razão (`customer_credits`) e o saldo é a soma dos lançamentos. Na reserva, o crédito abate o sinal primeiro. A linha do cliente é travada com `FOR UPDATE` para não gastar o mesmo crédito em duas reservas. Na liquidação, o crédito usado volta primeiro como crédito e o restante do Pix vai por reembolso ou crédito. Cancelamento pela empresa sempre devolve em dinheiro.

**Reembolso.** A chamada ao PSP fica fora da transação: grava `needs_refund` e tenta em seguida. Se falhar, o job tenta de novo e o painel mostra a pendência para reembolso manual.

**Riscos.** O cliente é identificado pelo telefone. Alguém que reserve com o telefone de outra pessoa consome o crédito dela, mas o agendamento e as mensagens vão para aquele telefone. Aceitável no MVP; reavaliar com verificação por código no WhatsApp.
