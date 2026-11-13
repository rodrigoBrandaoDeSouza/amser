# ADR 0003 — Sinal via Pix no MVP, dinheiro direto na conta do tenant

**Status:** aceita (spec v1.1 §9, §22) · **Data:** 2026-11-13

**Contexto.** Pilar 2 do posicionamento: "se paga cortando as faltas".

**Decisão.** Reserva provisória (`aguardando_sinal` + `hold_expires_at`, padrão 15 min) protegida pela exclusion constraint. Cobrança criada via interface `PaymentProvider` na conta do próprio tenant no PSP; o Amser não recebe nem repassa valores. Webhook idempotente (`webhook_events` + updates condicionais). Pagamento após a expiração não reativa o horário: marca `needs_refund` para reembolso manual (automação na Fase 2).

**Pendente (Fase 0).** Escolher o PSP e validar com ele e com o jurídico o modelo "conta do tenant" (evitar papel de intermediador de pagamento). Até lá, provider `mock` + rota de simulação só em dev.
