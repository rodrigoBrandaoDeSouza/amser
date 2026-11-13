# ADR 0011 — WhatsApp Cloud API oficial: templates, webhook e opt-out

**Status:** aceita · **Data:** 2026-11-13

**Contexto.** As mensagens automáticas (confirmação, lembretes, presença, lista de espera) são o canal principal do pilar 2. A Meta exige templates aprovados fora da janela de 24h, opt-in e tratamento de opt-out.

**Decisão.** Conferido na documentação oficial (Graph API v27.0):
- **Conexão por empresa:** Phone Number ID + WABA ID + token permanente de usuário do sistema, guardado criptografado. Ao salvar, validamos na Meta (`GET /{phone-number-id}` → nome verificado, qualidade, status) e inscrevemos o app na WABA (`POST /{waba-id}/subscribed_apps`). Um número não pode ser usado por duas empresas.
- **Templates padrão** (UTILITY, pt_BR, variáveis posicionais) criados via `POST /{waba-id}/message_templates`, com rodapé "Responda SAIR…". O status é sincronizado por listagem e pelo webhook `message_template_status_update`. Só enviamos templates `APPROVED`; os `PENDING` aguardam.
- O template de **confirmação de presença** usa só respostas rápidas, sem botão URL. A documentação não define o índice do botão URL quando também há respostas rápidas. Por isso, "Preciso remarcar" responde com o link em texto livre, dentro da janela de 24h aberta pelo toque.
- **Webhook:** assinatura `X-Hub-Signature-256` obrigatória. Roteamento por `metadata.phone_number_id`. Mensagens recebidas são deduplicadas pelo WAMID (a Meta reenvia por até 7 dias). Status nunca regridem. O botão é identificado pelo texto e o agendamento pelo `context.id` (WAMID do template).
- **Opt-out:** "SAIR/PARAR/STOP", erros 131050 e 130403, ou revogação no painel. O consentimento é checado ao enfileirar e de novo ao enviar.
- **Erros** classificados pelo código. Retentáveis com backoff: 130429, 131056, 80007, 4, 131000, 131016, 1, 2, 2494100 e 131057. Token inválido (190/0) marca a conexão com erro. Erros de template e definitivos vão para dead-letter.
- Guardamos o **BSUID** (`user_id`) do cliente quando chega.

**Pendências.** Embedded Signup (onboarding sem copiar token) exige o Amser ser Tech Provider da Meta. A preferência de marketing (`user_preferences`) só importa se houver campanhas, que são da Fase 3. Validar no primeiro envio real o formato do botão de resposta rápida no webhook (`button.text` vs `payload`).
