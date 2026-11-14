# ADR 0015 — Cadastro integrado da Meta e coexistência com o app WhatsApp Business

**Status:** aceita · **Data:** 2026-11-14 · Complementa a ADR 0011

**Contexto.** Os negócios de beleza atendem pelo app WhatsApp Business no celular, e o número é o principal canal de vendas deles. A conexão manual da ADR 0011 (IDs + token de usuário do sistema) tem três problemas:
- é técnica demais para o dono do negócio;
- tira o número do app;
- deixa a conta da Meta (e a cobrança das mensagens) no portfólio do Amser.

APIs não oficiais (QR Code) foram descartadas: violam os termos do WhatsApp, arriscam o banimento do número do cliente e contradizem o pilar "WhatsApp oficial".

**Decisão.** O Amser vira **Tech Provider** da Meta e oferece o **cadastro integrado** (Embedded Signup **v5**, versão atual desde 20/10/2026; v2/v3 foram descontinuadas em 15/10/2026). Na v5 a **coexistência** vem ligada: quem já usa o app WhatsApp Business escolhe o mesmo número, que continua funcionando no celular.

Conferido na documentação oficial em 2026-11-14.

**Navegador** (`ConnectWhatsappButton`):
- `FB.login` com `config_id` (configuração "Login do Facebook para Empresas", variação Embedded Signup), `response_type: "code"`, `override_default_response_type: true` e `extras: { setup: {}, version: "v5" }`.
- Os IDs chegam por `postMessage` `WA_EMBEDDED_SIGNUP`; só são aceitas mensagens de origem `facebook.com`.
- O sucesso é `FINISH` (número novo) ou `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` (coexistência). `FINISH_ONLY_WABA` é recusado, porque sem número não há o que enviar.

**Servidor** (`completeEmbeddedSignup`), tudo servidor→Meta, nada no navegador:
1. **Troca do código** (vale 30 s): `GET /oauth/access_token` com `client_id`, `client_secret` e `code`. O token de negócio é guardado criptografado.
2. **Registro do número:**
   - Número novo: `POST /{phone-number-id}/register` com PIN aleatório de 6 dígitos, guardado criptografado junto com o token.
   - Coexistência: **não registra**, porque o número já está registrado.
3. **Validação e webhook:** reaproveita a validação da ADR 0011 (nome verificado, status) e a inscrição do app na WABA. Os IDs vindos do navegador só passam se o token da Meta tiver acesso a eles, e um número não pode pertencer a duas empresas. O `tenantId` vem da sessão.
4. **Coexistência:** pede a sincronização (`POST /{phone-number-id}/smb_app_data`, `smb_app_state_sync` e `history`). A Meta exige isso em até 24h e só aceita uma vez.
5. **Modelos:** cria os modelos padrão do Amser automaticamente.

**Webhook:**
- `account_update` com `PARTNER_REMOVED` (o dono desconectou pelo app) **desativa** a conexão, e o outbox para de enviar.
- `smb_message_echoes`, `history` e `smb_app_state_sync` são **ignorados**. O Amser não guarda as conversas nem os contatos do app (minimização, LGPD; ADR 0014). Pedimos a sincronização só porque ela faz parte da conclusão do cadastro.
- Mensagens recebidas continuam com o tratamento da ADR 0011: só palavras exatas de opt-out e botões de templates do Amser geram ação. As demais conversas são atendimento humano no app.

**Conexão manual** (ADR 0011) continua disponível como "avançado", para quem já tem portfólio próprio, e no superadmin.

**Consequências.**
- **Cobrança:** a conta do WhatsApp fica no portfólio do cliente, e a Meta cobra as mensagens no cartão dele.
- **Limitações** para números em coexistência: 20 mensagens/s; o número perde listas de transmissão, mensagens temporárias, "ver uma vez" e o perfil comercial pela API; WhatsApp para Windows e WearOS deixam de funcionar como aparelhos conectados.
- **Requisito:** o app WhatsApp Business do cliente deve estar na versão 2.24.17 ou superior.
- **Pré-requisitos do Amser:**
  - empresa verificada na Meta;
  - app com acesso avançado a `whatsapp_business_management` e `whatsapp_business_messaging` (App Review);
  - configuração do Login do Facebook para Empresas (`WHATSAPP_ES_CONFIG_ID`);
  - webhook com os campos `account_update`, `smb_message_echoes`, `history` e `smb_app_state_sync`, além dos atuais.
- **Validar no primeiro cadastro real:**
  - o formato exato do `account_update` com `PARTNER_REMOVED` (usamos `entry.id` como WABA);
  - a validade do token de negócio, que a documentação não informa. Se ele expirar, a conexão cai com erro de autenticação (190) e o dono reconecta em um clique.
