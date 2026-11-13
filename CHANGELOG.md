# Changelog

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
