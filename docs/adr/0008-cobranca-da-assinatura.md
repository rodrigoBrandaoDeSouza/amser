# ADR 0008 — Cobrança da assinatura do SaaS

**Status:** aceita (PSP pendente) · **Data:** 2026-11-13

**Decisão.** `subscriptions` + `billing_invoices`. Teste de 14 dias. O job gera a fatura do próximo período 5 dias antes do vencimento (uma por período, garantido por chave única). Sem pagamento no vencimento, a assinatura vira `past_due` com 5 dias de tolerância; depois disso, a empresa é suspensa com `suspended_reason = billing` e o status anterior fica guardado. O webhook de pagamento (assinado e idempotente) ativa o período e só reverte suspensões por cobrança. O dono suspenso continua acessando `/painel/plano` para pagar. Troca de plano vale a partir da próxima fatura. Limites do plano (`limits_json`: professionals, units) são aplicados no cadastro.

**Recebedor.** Diferente do sinal: aqui quem recebe é o Amser. O PSP de cobrança (com cobrança recorrente via Pix e/ou cartão) será escolhido na Fase 0; `BillingProvider` isola a troca.
