# Publicação — Amser 1.0 (Railway + WhatsApp oficial)

Versão 1.0: **sem provedor de Pix**, com o sinal desativado e as reservas confirmadas sem pagamento. A cobrança da assinatura é manual, registrada pelo superadmin. As mensagens saem pelo **WhatsApp oficial da Meta**.

## 1. Railway

1. **New Project → Deploy from GitHub repo** → `amser`. O `railway.json` já define o build (`npm ci && npm run build`), o start (`npm run start:prod`: migrations + bootstrap + servidor) e o healthcheck (`/api/health`).
2. **+ New → Database → PostgreSQL** no mesmo projeto.
3. No serviço do app, crie um **Volume** com mount path `/data`, para guardar as fotos.
4. **Variables** do app (gere os segredos com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao banco do projeto) |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<seu-domínio>`. Na primeira vez, use o domínio `*.up.railway.app` gerado em Settings → Networking. |
| `SESSION_SECRET` | segredo aleatório (64 caracteres) |
| `CREDENTIALS_KEY` | 32 bytes em base64 (comando acima) |
| `JOBS_SECRET` | segredo aleatório |
| `PAYMENT_PROVIDER` | `none` |
| `BILLING_PROVIDER` | `none` |
| `WHATSAPP_PROVIDER` | `meta` |
| `WHATSAPP_APP_SECRET` | App Secret do app da Meta (passo 2) |
| `WHATSAPP_VERIFY_TOKEN` | texto aleatório de 16+ caracteres que você inventa (vai igual na Meta) |
| `STORAGE_PROVIDER` / `STORAGE_LOCAL_DIR` | `local` / `/data/uploads` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seu login de superadmin (12+ caracteres). Criado só no primeiro deploy. |
| `INSTAGRAM_PROVIDER` | `off` |
| `BRANDING_AI_PROVIDER` | `mock`, ou `anthropic` + `ANTHROPIC_API_KEY` |
| `EMAIL_PROVIDER` | `console` (link de senha só no log) ou `smtp` + `SMTP_*` |
| `TRUST_PROXY_HOPS` | `1` |

Se faltar algo, o servidor **não sobe** e mostra no log exatamente o que está errado.

5. **Worker (jobs)**: + New → GitHub repo (o mesmo) → em Settings, **Custom Start Command** `npm run worker`, com as **mesmas variáveis** e o mesmo volume (Shared Variables ajudam). Ele expira reservas, envia lembretes e pedidos de confirmação, oferece a lista de espera e aplica a retenção LGPD. Confirmações e cancelamentos já saem na hora pelo próprio app.
6. Acesse `https://<domínio>/login` com `ADMIN_EMAIL`. Depois, em **Minha conta**, troque a senha e ative a verificação em duas etapas.

## 2. Meta (WhatsApp Business Platform)

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Business** e adicione o produto **WhatsApp**.
2. **App Secret**: App settings → Basic → `WHATSAPP_APP_SECRET`.
3. **Webhook**: WhatsApp → Configuration.
   - Callback URL: `https://<domínio>/api/integrations/whatsapp/webhook`
   - Verify token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Campos a assinar: **messages** e **message_template_status_update**
4. **Número de cada empresa**: no Gerenciador de Negócios, crie um usuário do sistema com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, gere um **token permanente** e anote o **Phone Number ID** e o **WABA ID**.
5. No Amser (superadmin → empresa → **WhatsApp da empresa**, ou o dono em Integrações):
   1. **Salvar e validar na Meta**: mostra o nome verificado e a qualidade do número.
   2. **Enviar teste**: usa o modelo `hello_world`, que existe em toda conta nova e confirma que a entrega funciona.
   3. **Criar na Meta**: cria os 7 modelos do Amser. A aprovação leva de minutos a horas. Enquanto estiverem em análise, as mensagens ficam na fila e saem quando forem aprovados.
   4. Em **Mensagens**, escolha quais mensagens enviar e os horários.

### Cadastro integrado: o cliente conecta o próprio número (coexistência)

Com isso configurado, o dono clica em **Integrações → Conectar meu WhatsApp**, entra com o Facebook do negócio e escolhe o número. Quem já usa o **app WhatsApp Business** pode escolher o mesmo número: ele continua funcionando no celular. A conta fica no portfólio do cliente, e a Meta cobra as mensagens no cartão dele. Detalhes técnicos: [ADR 0015](adr/0015-whatsapp-coexistencia.md).

**Uma vez, para o Amser virar Tech Provider da Meta:**
1. **Verifique a empresa** no Gerenciador de Negócios (Central de Segurança → Verificação da empresa). Precisa de CNPJ, documento e um domínio ou e-mail da empresa. A análise leva de dias a semanas.
2. No app (tipo Business), em **WhatsApp → Início rápido**, siga o caminho de **Tech Provider**.
3. Peça na **Análise do app (App Review)** o acesso avançado a `whatsapp_business_management` e `whatsapp_business_messaging`. Grave um vídeo mostrando o botão "Conectar meu WhatsApp" do painel, de ponta a ponta.
4. Em **Login do Facebook para Empresas → Configurações**, crie uma configuração com a variação **WhatsApp Embedded Signup**. A Meta recomenda o modelo "WhatsApp Embedded Signup Configuration With 60 Expiration Token". Copie o **ID da configuração**.
5. No mesmo app, em Login do Facebook → Configurações, adicione o domínio do Amser em **Domínios permitidos para o SDK JavaScript**. Sem isso, a janela não abre.
6. No webhook do app, assine também os campos **`account_update`**, **`smb_message_echoes`**, **`history`** e **`smb_app_state_sync`**.
7. Variáveis do servidor: `WHATSAPP_APP_ID` (ID do app) e `WHATSAPP_ES_CONFIG_ID` (ID da configuração).

**Para o cliente:**
- O app WhatsApp Business precisa estar atualizado (versão 2.24.17 ou superior). WhatsApp pessoal não serve: ele migra para o Business antes, de graça e mantendo as conversas.
- Depois de conectar, ele cadastra uma **forma de pagamento** no Gerenciador do WhatsApp (business.facebook.com → WhatsApp → Pagamentos). As mensagens de lembrete são cobradas pela Meta.
- Nesse número, listas de transmissão e mensagens temporárias deixam de funcionar. As conversas normais no celular continuam.
- O Amser **não guarda** as conversas do app. Só envia as mensagens automáticas e entende "SAIR" e os botões dos lembretes.
- Para desconectar: no app WhatsApp Business, remova o parceiro. O Amser percebe sozinho e para de enviar.

Observações da Meta:
- Só recebe mensagem quem autorizou (opt-in na reserva).
- "SAIR" interrompe os envios para aquele cliente.
- Mensagens de utilidade são cobradas pela Meta na conta de cada empresa. Confira a tabela de preços para definir a franquia dos planos.

## 3. Depois de publicar

- **Domínio próprio do Amser**: Railway → Settings → Networking → Custom Domain. Atualize `APP_URL` e a Callback URL na Meta.
- **Domínios dos clientes**: depois que o dono verificar no painel, adicione como Custom Domain no Railway (é o que emite o HTTPS).
- **Backups**: ative no Postgres do Railway.
- **Quando houver PSP**: troque `PAYMENT_PROVIDER` e `BILLING_PROVIDER`. O sinal e a cobrança automática ligam sem mudança de código fora do provider.
