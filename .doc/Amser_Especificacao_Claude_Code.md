# Amser — SaaS Multi-Tenant de Agendamentos com Identidade Visual por IA
**Especificação funcional e técnica — versão 1.1**  
**Objetivo:** documento de implementação para Claude Code.  
**Mudanças da v1.1:** posicionamento e diferencial (§2), entrega faseada (§3), sinal via Pix no MVP (§9), prévia para prospect (§4.1), métricas de faltas (§11), WhatsApp incluído no plano (§10) e critérios de aceite revisados (§20). Base: [analise-concorrencia.md](analise-concorrencia.md).

## 1. Visão do produto
Criar uma plataforma SaaS white-label de agendamentos para profissionais autônomos e empresas de serviços com hora marcada: barbearias, salões de beleza, nail designers, designers de sobrancelhas, estúdios de estética, massagistas e outros segmentos configuráveis.

O administrador da plataforma cadastra cada empresa e envia fotos e logo do negócio (ou conecta o Instagram oficial, quando autorizado). Em seguida aciona uma análise de identidade visual por IA. O sistema propõe uma página pública responsiva de agendamento com aparência inspirada na marca da empresa, sem copiar a interface do Instagram. Cada empresa configura serviços, profissionais, disponibilidade, sinal via Pix, unidades e um canal WhatsApp para comunicações automatizadas.

## 2. Posicionamento e diferencial
O mercado já oferece agenda online, link na bio, lembrete por WhatsApp e página com logo e cor, entre R$ 0 e ~R$ 130/mês. Agentes de IA no WhatsApp também já existem em vários concorrentes. O Amser se diferencia em três pilares:

> *"Sua página de agendamento com a cara da sua marca, pronta em 10 minutos, e que se paga cortando as faltas. Sem comissão, sem taxa escondida de WhatsApp. O cliente é seu."*

1. **Sua cara, pronta em 10 minutos.** A IA de identidade visual é usada como **ferramenta de venda**: com 3 a 5 fotos e o logo enviados pelo dono, mostramos a página pronta **antes da assinatura** (§4.1). A IA não é o argumento central de retenção.
2. **Se paga cortando as faltas.** Sinal via Pix, confirmação pelo WhatsApp e liberação de horários não confirmados. O painel mostra o valor protegido no mês (§9, §11).
3. **Sem comissão, sem surpresa, o cliente é seu.** Não há marketplace nem concorrentes na página. O WhatsApp está incluído no plano até uma franquia clara. A base de clientes pode ser exportada a qualquer momento.

**Não usar como argumento central:** "tem IA no WhatsApp", "gestão completa" ou "mais barato".

**Regra de produto:** toda funcionalidade nova deve reforçar pelo menos um dos três pilares ou ser requisito básico de mercado. O que não se encaixa vai para o backlog.

## 3. Entrega faseada

### Fase 0 — Validação comercial (antes e em paralelo ao código)
1. Definir o segmento inicial. Hipótese: nail designer e designer de sobrancelhas (profissional solo, muito ativo no Instagram, mercado menos disputado que barbearia).
2. Fazer prévias de página **manualmente** (fotos do dono + IA + ajuste à mão) para 5 a 10 prospects e medir o interesse.
3. Verificar a tabela atual de preços da WhatsApp Cloud API para o Brasil (mensagens de utilidade) e calcular a franquia de mensagens por plano.
4. Escolher o PSP de Pix (candidatos: Mercado Pago, Asaas, Efí, Pagar.me), comparando taxa, API, webhooks e onboarding de contas.
5. Definir faixa de preço e modelo de cobrança (§21).
6. Conferir nos sites oficiais os preços dos concorrentes antes de usá-los em material de venda.

**Saída da Fase 0:** decisões da §21 fechadas e registradas em ADR.

### Fase 1 — MVP
1. Autenticação, multi-tenancy e painel superadmin.
2. Onboarding com upload de imagens e análise de marca por IA (revisão humana obrigatória).
3. **Prévia para prospect:** tenant em rascunho, não publicado e com expiração (§4.1).
4. Editor de tema e página pública responsiva.
5. Serviços, profissionais, horários, clientes e agendamentos.
6. Agenda administrativa e bloqueio robusto de conflitos.
7. **Sinal via Pix** configurável por serviço, com reserva provisória e expiração (§9).
8. WhatsApp Cloud API: conexão, confirmação, lembretes, pedido de confirmação de presença e logs.
9. Dashboard básico com **métricas de faltas** (§11) e trilha de auditoria.
10. Teste de carga simulando pico (sábado de manhã).

### Fase 2 — Crescimento
- Integração oficial com o Instagram (Instagram Login / `instagram_business_basic`) para importar mídia, quando permitida e após App Review da Meta.
- Assinatura do SaaS automatizada (cobrança recorrente, trial, inadimplência).
- Lista de espera que oferece automaticamente o horário liberado (reforça o pilar 2).
- Múltiplas unidades, domínio próprio e cupons.
- Políticas avançadas de sinal: crédito para remarcação, retenção parcial e reembolso automático.
- Onboarding self-service (o dono gera a própria prévia sem o superadmin), se a Fase 0 indicar demanda.

### Fase 3 — Expansão
- Chatbot no WhatsApp (identificar cliente, consultar horários, criar e remarcar com confirmação explícita, transferir para humano). Não é diferencial: entra apenas como paridade de mercado.
- Campanhas com opt-in e recuperação de clientes inativos.
- Fidelidade, avaliações, relatórios avançados e recomendações inteligentes.

## 4. Perfis e isolamento
- **Superadmin SaaS:** gerencia tenants, prévias de prospect, planos, assinaturas, uso, integrações, suporte e auditoria.
- **Proprietário da empresa:** gerencia sua marca, serviços, profissionais, clientes, agenda, sinal/Pix, WhatsApp e relatórios.
- **Funcionário/profissional:** acessa apenas agendas e dados autorizados, com permissões configuráveis.
- **Cliente final:** agenda, paga o sinal, consulta, confirma, remarca e cancela pelo link público; conta opcional.

Toda entidade de negócio deve ter `tenant_id`. Aplicar isolamento em todas as consultas, APIs, jobs, arquivos, cache e eventos. Nunca confiar em `tenant_id` fornecido pelo cliente sem validação do contexto autenticado.

### 4.1 Prévia para prospect (Fase 1)
Fluxo de venda: o vendedor recebe fotos e logo do prospect (pelo WhatsApp ou pessoalmente), gera a prévia e mostra a página pronta.
- Criada pelo superadmin como tenant com status `prospect`.
- Exige confirmação de que o prospect **enviou ou autorizou** as imagens (`rights_confirmed`). **Proibido** gerar prévias a partir do Instagram público sem autorização.
- Serviços e preços de exemplo ficam marcados visualmente como "exemplo". Nunca inventar depoimentos ou promoções.
- URL de prévia não indexável (`noindex`), sem agendamento real, acessível por token.
- Expiração automática (padrão: 14 dias). Ao expirar, apagar mídias e dados (LGPD).
- Conversão em um clique: `prospect` → `onboarding`, mantendo tema e mídias aprovados.
- **Meta de produto:** da chegada das fotos à prévia pronta em **menos de 10 minutos**.

## 5. Onboarding de uma empresa
1. Superadmin cria o tenant (ou converte uma prévia de prospect) com nome, segmento, contato, plano e slug único.
2. **Padrão:** o dono envia logo e fotos (upload manual com confirmação de direitos). **Opcional (Fase 2):** conectar o Instagram pela API oficial da Meta.
3. A IA analisa somente imagens legitimamente acessíveis e sugere paleta, tipografia, estilo, tom de voz, banners e disposição da página.
4. Mostrar prévia editável, com opção de aceitar ou ajustar cada sugestão. Não publicar automaticamente.
5. O proprietário cadastra serviços, duração, preços, **regras de sinal**, profissionais, horários, feriados, regras e WhatsApp.
6. Configuração assistida da conexão com o PSP (Pix) e do número de WhatsApp.
7. Publicar a página em `https://app.exemplo.com/{slug}` e oferecer link/QR code para a bio do Instagram.

**Importante:** não presumir acesso a fotos de qualquer conta pública do Instagram. A integração depende de permissões, tipos de conta, App Review e políticas vigentes da Meta. Não usar scraping não autorizado. A IA deve produzir sugestões, não prometer reprodução fiel da marca.

## 6. Gerador de identidade visual com IA
**Entradas:** nome da marca, segmento, fotos carregadas, logo, preferências e, na Fase 2, perfil autorizado do Instagram.

**Saída estruturada em JSON validado:**
- Cores: primária, secundária, fundo, texto e destaque (HEX).
- Fontes licenciadas ou fontes web disponíveis.
- Estilo visual: minimalista, premium, moderno, delicado, urbano etc.
- Elementos: bordas, botões, cards, ícones e espaçamentos.
- Copy sugerida: título, descrição, chamada para ação.
- Seleção de imagens aprovadas e proposta de hero.
- Metadados de acessibilidade, incluindo contraste mínimo e alternativas de texto.

**Fluxo:** coletar materiais autorizados → processar e reduzir imagens → analisar com modelo multimodal → validar JSON → salvar rascunho versionado → renderizar preview → aprovação humana → publicar.

**Desempenho:** a análise deve terminar em segundos, para caber na meta de prévia em menos de 10 minutos (§4.1). Mostrar o progresso ao usuário.

Não inventar serviços, preços, promoções ou depoimentos. Nunca usar imagens de terceiros sem direitos adequados. Permitir reprocessar a identidade visual e restaurar versões anteriores.

## 7. Página pública de agendamento
- Layout mobile-first, rápido, com tema individual por tenant.
- Logo, capa, descrição, localização, contato, galeria e redes sociais.
- **Sem marketplace:** nenhum outro estabelecimento é exibido ou sugerido.
- Catálogo de serviços por categoria, preço, duração, descrição e valor do sinal (quando houver).
- Seleção de serviço → profissional (ou qualquer disponível) → data → horário → dados do cliente → pagamento do sinal (se exigido) → confirmação.
- Bloquear horários conflitantes com validação transacional no servidor.
- Exibir política de cancelamento, regras do sinal e consentimento de comunicações **antes** do pagamento.
- Página de confirmação com ações de adicionar ao calendário, remarcar ou cancelar conforme regras.
- Link único por empresa; suporte futuro a domínio próprio.
- SEO básico, Open Graph, acessibilidade e idioma pt-BR.

## 8. Agenda e regras
- Serviços com duração, preço, intervalo de preparação/limpeza, regra de sinal e profissionais habilitados.
- Jornada por profissional, pausas, férias, feriados, bloqueios e exceções.
- Fuso horário por unidade, persistindo instantes em UTC.
- Antecedência mínima, horizonte máximo, tolerância de atraso e limite de cancelamento configuráveis.
- Status: `aguardando_sinal`, `pendente`, `confirmado`, `concluido`, `cancelado`, `nao_compareceu`, `expirado`.
- Reagendamento atômico: liberar o horário antigo apenas após reservar o novo com sucesso. O sinal pago acompanha o agendamento remarcado.
- Controle de concorrência para evitar agendamento duplo, incluindo reservas provisórias em `aguardando_sinal`.
- Pedido de confirmação de presença pelo WhatsApp. Se não houver resposta até o prazo configurado, notificar o dono e, se configurado, liberar o horário.
- Agendamento manual por recepcionista (com ou sem sinal) e histórico de alterações.
- Múltiplas unidades opcionais no modelo de dados, mesmo que o MVP use uma.

## 9. Sinal via Pix (Fase 1)
**Objetivo:** reduzir faltas (pilar 2).

**Configuração por serviço:** sem sinal, percentual do preço ou valor fixo. Padrão sugerido: 30%.

**Fluxo:**
1. O cliente escolhe o horário. O sistema cria o agendamento em `aguardando_sinal`, ocupando o horário de forma provisória.
2. O sistema gera uma cobrança Pix (QR code + copia e cola) com expiração (padrão: 15 minutos).
3. O webhook do PSP confirma o pagamento → o agendamento passa a `confirmado` e a confirmação sai pelo WhatsApp.
4. Expirou sem pagamento → o agendamento passa a `expirado` e o horário é liberado.

**Regras de negócio:**
- Cancelamento dentro do prazo → reembolso ou crédito, conforme política do tenant (MVP: reembolso manual registrado; automação na Fase 2).
- Cancelamento fora do prazo ou falta → sinal retido, conforme a política exibida ao cliente.
- O valor do sinal é abatido do preço no fechamento do atendimento.

**Arquitetura de pagamento:**
- O dinheiro vai **direto para a conta do tenant no PSP**. O Amser não recebe nem repassa valores, o que evita atuar como intermediador de pagamentos. Validar essa decisão com o PSP escolhido e com o jurídico.
- Camada de provedores desacoplada (como no WhatsApp), com mock no ambiente local.
- Webhooks com verificação de assinatura, idempotência por `provider_charge_id` e conciliação periódica para pagamentos cujo webhook não chegou.
- Falha do PSP nunca duplica nem confirma agendamento indevidamente.
- Credenciais do PSP em cofre; nunca no frontend.

## 10. CRM de clientes
- Nome, telefone normalizado em E.164, e-mail opcional, observações e preferências.
- Histórico de serviços, visitas, sinais pagos, cancelamentos e faltas.
- Busca, filtros, etiquetas e importação CSV.
- **Exportação CSV da base completa a qualquer momento** (pilar 3: "o cliente é seu").
- Deduplicação por telefone dentro do tenant.
- Consentimentos, opt-out e retenção configurável conforme a LGPD.
- Dados sensíveis de saúde/estética não devem ser coletados no MVP.

## 11. Integração WhatsApp
Criar uma camada de provedores com interface desacoplada. Priorizar a **WhatsApp Business Platform / Cloud API oficial**, observando requisitos de conta comercial, número, templates aprovados, janela de atendimento, custos e políticas da Meta.

**Configuração por tenant:** número/remetente, credenciais protegidas, status de conexão, templates, horários de envio e opt-out. O número é do próprio tenant; não presumir que números possam ser compartilhados entre empresas. O onboarding oferece configuração assistida.

**Modelo comercial:** o WhatsApp está **incluído no plano** até uma franquia mensal de mensagens (definida na Fase 0 a partir do custo real da Meta). Ao se aproximar do limite, avisar o dono antes de qualquer cobrança extra. Nunca bloquear confirmações de agendamento sem aviso prévio.

**Eventos automatizados:**
- Confirmação de agendamento (após o sinal, quando houver).
- Lembrete configurável (ex.: 24h e 2h antes).
- Pedido de confirmação de presença.
- Reagendamento/cancelamento e status do sinal.
- Mensagem pós-atendimento, mediante consentimento e regras da plataforma.

**Requisitos técnicos:** webhooks com verificação de assinatura, idempotência, filas, retentativas com backoff, dead-letter queue, registro de status e erros, limites de envio, controle de franquia por tenant, templates por idioma e variáveis seguras. Nunca colocar tokens no frontend. Mensagens iniciadas pela empresa devem respeitar templates e o opt-in aplicável.

**MVP:** notificações unidirecionais e links de ação (confirmar, remarcar, cancelar) autenticados por token temporário. **Fase 3:** chatbot (§3).

## 12. Painel do proprietário
- Dashboard: agendamentos de hoje, próximos horários, taxa de ocupação, cancelamentos e faltas.
- **Métricas de faltas (pilar 2), com definição honesta:**
  - Taxa de faltas do mês e evolução em relação aos meses anteriores.
  - Sinais retidos em faltas e cancelamentos tardios (R$).
  - Horários liberados por falta de confirmação ou de pagamento que foram reocupados (quantidade e R$ estimado).
  - Não afirmar "faltas evitadas" como fato; usar termos mensuráveis como os acima.
- Agenda diária/semanal por profissional e unidade.
- CRUD de serviços, categorias, profissionais, horários, bloqueios e clientes.
- Editor visual da página e prévia mobile/desktop.
- Integrações (Pix, WhatsApp e, na Fase 2, Instagram), templates, logs de envio e consumo da franquia.
- Relatórios de agendamentos e faturamento **estimado** (não confundir com recebimentos), além dos sinais recebidos.
- Usuários, papéis, permissões e configurações.

## 13. Painel superadmin
- Cadastro, ativação, suspensão e exclusão programada de tenants.
- **Prévias de prospect:** criar, compartilhar link, acompanhar expiração e converter em tenant.
- Planos, limites por usuários/profissionais/unidades/mensagens e trial.
- Métricas: tenants ativos, conversão prévia → assinatura, agendamentos, uso de mensagens, falhas e custos por integração.
- Auditoria, suporte com acesso temporário autorizado e gestão de assinaturas.
- Feature flags e configuração global de provedores de IA, WhatsApp e PSP.

## 14. Modelo de dados inicial
- `tenants(id, name, slug, segment, status[prospect|onboarding|active|suspended|deleted], plan_id, timezone, preview_token, preview_expires_at, created_at)`
- `tenant_branding(id, tenant_id, theme_json, source_metadata_json, version, status)`
- `tenant_media(id, tenant_id, storage_key, rights_confirmed, rights_confirmed_by, created_at)`
- `units(id, tenant_id, name, address, timezone)`
- `users(id, tenant_id, name, email, password_hash, role, status)`
- `professionals(id, tenant_id, user_id_nullable, unit_id, display_name, active)`
- `services(id, tenant_id, category_id, name, duration_minutes, buffer_minutes, price, deposit_type[none|percent|fixed], deposit_value, active)`
- `service_professionals(tenant_id, service_id, professional_id)`
- `working_hours(id, tenant_id, professional_id, weekday, start_time, end_time)`
- `schedule_exceptions(id, tenant_id, professional_id, starts_at, ends_at, type)`
- `customers(id, tenant_id, name, phone_e164, email, consent_json)`
- `appointments(id, tenant_id, unit_id, customer_id, professional_id, service_id, starts_at, ends_at, status, price_snapshot, deposit_amount_snapshot, hold_expires_at, confirmed_presence_at, created_at)`
- `appointment_events(id, tenant_id, appointment_id, actor_id, event_type, payload_json, created_at)`
- `payment_connections(id, tenant_id, provider, encrypted_credentials_ref, status)`
- `payments(id, tenant_id, appointment_id, provider, provider_charge_id, amount, status[pending|paid|expired|refunded|retained], expires_at, paid_at, refunded_at, created_at)`
- `whatsapp_connections(id, tenant_id, provider, phone_number_id, encrypted_credentials_ref, status)`
- `message_templates(id, tenant_id, event_type, provider_template_id, enabled)`
- `message_outbox(id, tenant_id, appointment_id, template_id, scheduled_at, status, attempts, provider_message_id)`
- `message_usage(tenant_id, period, messages_sent, quota)`
- `plans(id, name, limits_json, message_quota, price)`
- `subscriptions(id, tenant_id, plan_id, status, period_start, period_end)`
- `audit_logs(id, tenant_id_nullable, actor_id, action, resource, created_at)`

Adicionar índices por `tenant_id`, intervalos de agenda, status, telefone e `provider_charge_id` (único). Implementar restrição contra sobreposição de horários, inclusive em concorrência, considerando como ativos os status `aguardando_sinal` (até `hold_expires_at`), `pendente` e `confirmado`. No PostgreSQL, considerar exclusion constraints para intervalos ativos ou um mecanismo transacional equivalente.

## 15. Arquitetura aprovada — baixo custo
- Nome do produto e repositório: **Amser** (`amser`).
- **Aplicação única Next.js full-stack**, TypeScript, App Router e Tailwind. Sem backend .NET separado.
- **Banco PostgreSQL no Railway**, com Prisma ORM e migrations. Aplicação e banco no mesmo projeto Railway, em serviços separados. Monitorar custos; não presumir banco gratuito permanente.
- **Multi-tenant:** um banco para todas as empresas, com isolamento rigoroso por `tenant_id`.
- **Endereço público:** `https://seudominio.com.br/{slug}` (exemplo: `/barbearia-do-joao`). Durante o desenvolvimento, usar a URL provisória do Railway. Subdomínio e domínio próprio ficam para versões futuras.
- **Identidade visual:** IA por API analisa materiais autorizados (upload manual no MVP; Instagram oficial na Fase 2), gera tema revisável e páginas responsivas.
- **WhatsApp:** integração oficial Meta Cloud API com configuração por empresa, outbox PostgreSQL e processamento agendado simples.
- **Pix:** PSP único no MVP, atrás de uma interface de provedor; cobrança na conta do tenant; expiração de reservas e conciliação por job agendado simples.
- **Mídias:** object storage externo quando necessário; não guardar uploads no disco efêmero do Railway.
- **Segurança:** autenticação, autorização por tenant, rate limiting, secrets em variáveis protegidas, backups e logs.
- Não adicionar Supabase, Redis, microsserviços ou outros componentes sem necessidade comprovada.

## 16. Endpoints exemplificativos
- `POST /admin/tenants`
- `POST /admin/prospects` · `POST /admin/prospects/{id}/convert`
- `GET /preview/{token}`
- `POST /tenants/{id}/branding/analyze`
- `GET /tenants/{id}/branding/preview`
- `POST /tenants/{id}/branding/publish`
- `GET /public/{slug}/services`
- `GET /public/{slug}/availability?serviceId=&professionalId=&date=`
- `POST /public/{slug}/appointments` (retorna a cobrança Pix quando houver sinal)
- `GET /public/appointments/{token}/payment-status`
- `POST /appointments/{id}/confirm`
- `POST /appointments/{id}/reschedule`
- `POST /appointments/{id}/cancel`
- `POST /integrations/whatsapp/webhook`
- `POST /integrations/payments/{provider}/webhook`
- `GET /dashboard/appointments`
- `GET /dashboard/metrics/no-show`
- `GET /dashboard/customers` · `GET /dashboard/customers/export`

Não expor IDs de tenants de terceiros nem confiar apenas em slugs para autorizar operações privadas.

## 17. Segurança, privacidade e qualidade
- Autenticação segura, RBAC, MFA opcional, refresh token seguro e senhas com hash robusto.
- Isolamento tenant-aware testado; políticas de autorização por recurso.
- Criptografia em trânsito e em repouso; credenciais de integração (WhatsApp, PSP, IA) em cofre.
- LGPD: base legal, transparência, consentimento quando exigido, exportação, exclusão e prazos de retenção, incluindo a limpeza das prévias de prospect expiradas.
- Verificar a autenticidade dos webhooks (WhatsApp e PSP); idempotência de agendamentos, pagamentos e notificações.
- Sanitizar textos, uploads e respostas da IA; tratar conteúdo externo como dado não confiável.
- Logs estruturados sem vazar dados pessoais nem dados de pagamento; monitorar custos por tenant.
- Testes unitários de disponibilidade e de regras de sinal, testes de integração de concorrência, e2e do fluxo de reserva com Pix (mock) e testes de autorização entre tenants.
- **Teste de carga de pico:** simular o sábado de manhã (muitos clientes consultando disponibilidade e reservando ao mesmo tempo). Estabilidade em pico é a principal reclamação contra os concorrentes.

## 18. Instruções para Claude Code
1. Respeitar a arquitetura aprovada na §15. Antes de codificar, criar `docs/architecture.md`, `docs/database.md`, `docs/api.md` e `docs/tasks.md`.
2. Implementar **apenas a fase aprovada** (§3). Não antecipar recursos de fases posteriores sem aprovação; registrar decisões em ADRs.
3. Definir contratos e o esquema do banco antes das telas; criar migrations versionadas.
4. Implementar vertical slices completas, com testes, em vez de gerar telas sem backend.
5. Usar mocks para Meta/WhatsApp, PSP/Pix e IA no ambiente local; integrações reais apenas com credenciais configuradas.
6. Criar seed de dois tenants de segmentos diferentes (um com sinal obrigatório, outro sem) e uma prévia de prospect, demonstrando o isolamento.
7. Fornecer `.env.example`, Docker Compose, README, comandos de setup, testes e deploy.
8. Não assumir recursos da API do Instagram sem validar a documentação e as permissões.
9. Priorizar a experiência mobile e a consistência visual entre o painel e a página pública.
10. Ao propor funcionalidades, indicar qual pilar da §2 cada uma reforça.

## 19. Métricas de sucesso do produto
- Tempo da chegada das fotos à prévia pronta: **< 10 min**.
- Conversão de prévia de prospect em assinatura.
- Taxa de faltas dos tenants antes e depois de ativar o sinal.
- Churn mensal de tenants.
- Disponibilidade da página pública em horário de pico.

## 20. Critérios de aceite do MVP
- Criar dois tenants com identidade visual e dados completamente separados.
- Criar tema a partir de imagens enviadas, editar, pré-visualizar e publicar.
- Gerar uma prévia de prospect em menos de 10 minutos, acessível por token, não indexável, que expira e apaga os dados automaticamente.
- Cliente consegue reservar pelo celular em até cinco etapas principais, além do pagamento do sinal quando exigido.
- Duas tentativas simultâneas não conseguem ocupar o mesmo horário/profissional, inclusive durante a reserva provisória de `aguardando_sinal`.
- Pix não pago dentro do prazo libera o horário automaticamente; Pix pago confirma o agendamento uma única vez, mesmo com webhook duplicado.
- Proprietário pode bloquear a agenda e reagendar respeitando as regras; o sinal acompanha o reagendamento.
- Mensagens aprovadas chegam pelo provedor configurado, têm status rastreável e o consumo da franquia é contabilizado.
- Falha no WhatsApp ou no PSP não cancela nem duplica agendamento.
- Dashboard exibe a taxa de faltas e os valores de sinais retidos.
- Proprietário exporta a base de clientes em CSV.
- Tokens, credenciais e dados privados não aparecem na página pública.
- Página pública permanece estável no teste de carga de pico.
- Interface funcional em mobile e desktop, com testes e instruções de deploy.

## 21. Decisões de produto pendentes (fechar na Fase 0)
| Decisão | Recomendação atual |
|---|---|
| Segmento inicial | Nail designer e sobrancelha (solo + Instagram forte); barbearia depois. |
| Venda assistida ou self-service | Assistida no início (prévia para prospect); self-service na Fase 2. |
| PSP de Pix | Escolher entre Mercado Pago, Asaas, Efí e Pagar.me pela taxa, API e onboarding. |
| Cobrança do SaaS | Por faixa de profissionais, com WhatsApp incluído até uma franquia. |
| Faixa de preço | Validar entre R$ 50 e R$ 130/mês com sinal e WhatsApp incluídos; não competir no "grátis". |
| Franquia de mensagens | Calcular a partir da tabela atual da Meta para o Brasil. |
| Política padrão do sinal | 30%, retido em falta ou cancelamento com menos de 24h; ajustável por tenant. |

## 22. Decisões confirmadas
- Nome definitivo escolhido: **Amser**.
- Repositório GitHub: `amser`.
- Domínio comercial ainda não definido; não presumir disponibilidade de marca ou domínio.
- Usar URL pública `/{slug}` para cada empresa.
- Next.js full-stack, Prisma, PostgreSQL e Railway.
- **Upload manual de imagens como padrão**; Instagram oficial opcional (Fase 2).
- **Revisão humana obrigatória** do tema gerado por IA.
- **Sinal via Pix no MVP**, com o dinheiro indo direto para a conta do tenant no PSP.
- **Sem marketplace**: a página de um tenant nunca exibe outros estabelecimentos.
- **WhatsApp incluído no plano** até uma franquia; número do próprio tenant.
- Chatbot no WhatsApp fica para a Fase 3, como paridade de mercado.
