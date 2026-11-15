# Changelog

## Não lançado

**Superadmin e cadastro de serviços**
- Superadmin gerencia o painel de qualquer empresa pelo botão "Gerenciar", sem autorização prévia do dono e sem usar a senha do cliente. Faixa no topo mostra a empresa; tudo fica na auditoria com o usuário do superadmin; o dono vê os acessos em Configurações (ADR 0016).
- Seleção dos profissionais do serviço em cartões grandes (bons para o celular), com contador, "selecionar todos/limpar", busca para equipes grandes e aviso quando ninguém está marcado.

**Layout e navegação**
- Painel e superadmin com menu lateral agrupado por tarefa (Agenda e clientes, Seu negócio, Página e WhatsApp, Conta), ícones, item ativo destacado e menu deslizante no celular.
- Telas de carregamento: esqueleto com o formato da página ao trocar de tela, barra de progresso no topo e spinner no item clicado.
- Botões mostram spinner e ficam bloqueados enquanto a ação roda (evita duplo envio).
- Agendamento: etapas com nome ("Serviço · Profissional · Horário · Seus dados"), volta por etapa, resumo da escolha, esqueleto dos horários, tela "Horário reservado!" logo após confirmar, spinners em cupom, lista de espera, confirmação, remarcação e cancelamento.

**WhatsApp: conecte o próprio número (coexistência)**
- Botão "Conectar meu WhatsApp" em Integrações (cadastro integrado da Meta, Embedded Signup v5): o dono entra com o Facebook e escolhe o número, sem copiar IDs ou tokens.
- Coexistência: o número continua funcionando no app WhatsApp Business do celular; o Amser envia só as mensagens automáticas e não guarda as conversas do app.
- Número novo: registro automático na Cloud API. Modelos de mensagem criados na hora.
- Desconexão pelo app (PARTNER_REMOVED) desativa os envios sozinha. Conexão manual continua como "avançado". ADR 0015.

**Deploy**
- Publicação em VPS (Hostinger, Hetzner): `docker-compose.prod.yml` com Caddy (HTTPS automático, inclusive para domínios próprios verificados via `/api/tls/ask`), Postgres, app, worker e backup diário (`deploy/vps/backup.sh`, com envio opcional ao R2). Guia: `docs/deploy-vps.md`.

**Correções**
- Instagram salvo como link completo aparecia como "@https://www.instagram.com/…". Agora o @ é extraído de qualquer formato (link, @ ou nome).

## 1.0.0 — 2026-11-13

Primeira versão publicável.

**Produto**
- Página de agendamento com a identidade visual do negócio (tema sugerido por IA, revisão humana), domínio próprio e várias unidades.
- Reserva em até 4 passos, cupons, lista de espera com oferta automática pelo WhatsApp, gestão do agendamento pelo cliente (confirmar, remarcar, cancelar, calendário).
- Painel do dono:
  - agenda (dia e semana), serviços, equipe com permissões;
  - clientes (CRM, importação CSV, LGPD);
  - relatórios, mensagens automáticas, marca, unidades, integrações, plano.
- Superadmin: empresas, prévia para prospect, conexão do WhatsApp, flags, modo suporte autorizado, exclusão programada, MRR.
- Cadastro self-service com teste grátis.

**WhatsApp (API oficial da Meta, Graph v27.0)**
- Conexão validada, 7 templates criados e sincronizados por API, envio imediato de confirmações, lembretes e pedido de presença.
- Botões "Confirmo presença" e "Preciso remarcar", opt-out por "SAIR", mensagem de teste (`hello_world`).

**Nesta versão, sem provedor de pagamento**
- `PAYMENT_PROVIDER=none`: o sinal fica desativado e as reservas são confirmadas sem Pix. As regras de sinal ficam salvas para quando houver PSP.
- `BILLING_PROVIDER=none`: nenhuma fatura ou suspensão automática; o pagamento é registrado manualmente pelo superadmin.
- Em produção, os providers simulados nunca são usados.

**Operação e segurança**
- Checagem de configuração ao subir: o servidor não inicia com configuração insegura.
- Bootstrap de planos e superadmin; worker de jobs separado.
- Agenda sem horário duplicado sob concorrência (advisory lock + exclusion constraint).
- Isolamento por empresa, webhooks assinados e idempotentes, credenciais criptografadas, MFA opcional, LGPD (portabilidade, eliminação, retenção).
- 97 testes automatizados, 6 cenários E2E no navegador e teste de carga.

Pendências conhecidas: ver `docs/tasks.md` (PSP, e-mail SMTP, bucket S3/R2, App Review do Instagram, Next 16 / Prisma 7).
