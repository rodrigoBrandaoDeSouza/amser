# ADR 0006 — Lista de espera com oferta pelo WhatsApp

**Status:** aceita · **Data:** 2026-11-13 · **Pilar:** 2 (cortar faltas)

**Decisão.** Entradas por dia/serviço (profissional e unidade opcionais), com opt-in obrigatório e no máximo 3 ativas por cliente. Quando um horário é liberado (cancelamento, Pix expirado, liberação por falta de confirmação ou remarcação), `offerFreedSlot` envia um link assinado (`/w/{token}`, válido até o fim do dia) para até 3 pessoas da fila que tenham horário compatível naquele momento. Não há reserva exclusiva da vaga: quem confirmar primeiro fica com ela, e a exclusion constraint resolve a disputa.

**Por que não reservar a vaga para o 1º da fila?** Uma reserva com prazo deixaria o horário parado enquanto ninguém responde, que é exatamente o desperdício que queremos evitar.

**Consequências.** O gatilho fica fora da transação da agenda e falha sem afetá-la. A mensagem usa o outbox (respeita a janela de envio). O template da Meta precisa de botão com URL base `/w/{{1}}`.
