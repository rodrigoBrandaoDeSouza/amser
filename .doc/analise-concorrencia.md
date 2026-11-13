# Amser — Análise de concorrência e diferencial

**Data:** 12/11/2026 · **Base:** [Amser_Especificacao_Claude_Code.md](Amser_Especificacao_Claude_Code.md)

> Aviso sobre as fontes: a maior parte dos preços e números vem de páginas e blogs dos
> próprios concorrentes. As fontes divergem entre si. Use os números como ordem de grandeza
> e confira nos sites oficiais antes de usar em material de venda.

---

## 1. Resumo

O mercado brasileiro de agendamento para beleza está **lotado e barato**. Há dezenas de
sistemas entre R$ 0 e R$ 130/mês. Agenda online, link na bio, lembrete por WhatsApp e
"página com a sua marca" (logo + cor) **já são básicos do mercado**. Em 2026 também
surgiu uma onda de **agentes de IA no WhatsApp** (Atendente.AI, BestBarbers, RobotiZap,
Barberia.io e outros).

**Não encontrei ninguém que gere a identidade visual da página por IA a partir do
Instagram e das fotos do negócio.** Esse é o espaço livre do Amser. Mas, sozinho, ele é
um diferencial **fraco para reter cliente**: impressiona no primeiro dia e depois o dono
não pensa mais nisso. Também é fácil de copiar.

**Recomendação:** usar a IA de identidade visual como **arma de venda**, e não como
argumento central. O argumento que fecha a venda e mantém o cliente pagando é dinheiro:
**menos faltas, nenhuma comissão e preço sem surpresa.**

> **Posicionamento proposto:**
> *"Sua página de agendamento com a cara da sua marca, pronta em 10 minutos, e que se
> paga cortando as faltas. Sem comissão, sem taxa escondida de WhatsApp. O cliente é seu."*

---

## 2. Mapa de concorrentes

### 2.1 Sistemas de gestão tradicionais (beleza/barbearia)

| Concorrente | Preço de entrada (aprox.) | WhatsApp | Observação |
|---|---|---|---|
| **Trinks** | ~R$ 110/mês (1–2 prof.) ou ~R$ 76 no anual; 3+ sob consulta | **Cobrado à parte** (adicional em todas as faixas) | Líder em salão; gestão completa |
| **AppBarber** | R$ 79,90–89/mês | Fontes divergem (app/SMS vs WhatsApp) | Foco em barbearia; reclamações sobre estoque/pacotes |
| **Simples Agenda** | R$ 39,90 (1) · R$ 69,90 (3) · R$ 89,90 (5) · R$ 119,90 (10) | Sim | Preço por faixa de profissionais |
| **Booksy** | ~R$ 99,90 + ~R$ 20/prof. adicional | Limitado (SMS/push) | Marketplace internacional |
| **Fresha** | Assinatura em US$ + **~20% da 1ª reserva de cliente novo** vindo do marketplace (mín. ~US$ 6) | — | A taxa vale mesmo se o cliente achou no marketplace e reservou por outro canal |
| **Cash Barber / BestBarbers** | — | — | Reclamações no Reclame Aqui: travamento aos sábados, suporte lento |

### 2.2 Agendadores leves (link na bio)

| Concorrente | Preço | Observação |
|---|---|---|
| **GENDA** | Grátis (1 prof., 50 msgs) · R$ 39,90 · R$ 79,90 · R$ 129,90 | Limite de mensagens no plano grátis |
| **Barbeiro.app** | Grátis · Pro R$ 39,90 | Comissão, fidelidade e estoque no Pro |
| **TopAgenda** | Grátis (60 ag./mês) · R$ 49 · R$ 79 | — |
| **Agende-me** | A partir de R$ 59,90 | Página com a marca só nos planos pagos |
| **agendamento.link, Minha Agenda Virtual, udiAgenda** | Variados | Personalização = **escolher cor + subir logo**, de forma manual |

### 2.3 Agentes de IA no WhatsApp (nova onda de 2026)

| Concorrente | O que faz |
|---|---|
| **Atendente.AI** | IA agenda pelo WhatsApp, Instagram e site; entende áudio |
| **BestBarbers** | Agente IA que agenda, remarca e cancela; ativação via time de vendas |
| **RobotiZap** | Fluxo guiado ou IA conversacional; sem app e sem cadastro |
| **Barberia.io** | IA no WhatsApp + app próprio + Pix + comissões |
| **SempreAqui, OP2P, Marcaí** | Recepcionista virtual 24h, recuperação de clientes sumidos |

Um blog estima que operar chatbot na API oficial + lembretes + fila custe de R$ 100 a
R$ 300/mês. **Conclusão:** o chatbot da Fase 3 do Amser **não será diferencial**; quando
chegar, já será básico do mercado.

---

## 3. Dores do dono do negócio (o que realmente vende)

1. **Faltas (no-show) = dinheiro perdido.** Os blogs do setor falam em até 20% de faltas
   e em R$ 4–6 mil/ano perdidos por um salão pequeno. Sinal via Pix + lembrete aparece
   como o remédio mais citado, com reduções relatadas de 50% a 65%. *(Números de marketing,
   não pesquisa independente. Os dados atribuídos ao SEBRAE não foram confirmados na fonte
   original.)*
2. **Custo escondido.** WhatsApp como adicional (Trinks), limite de mensagens nos planos
   grátis, comissão de marketplace (Fresha).
3. **"O cliente não é meu."** Marketplaces mostram concorrentes ao lado e cobram pelo
   cliente que o próprio salão atraiu pelo Instagram.
4. **Instabilidade em horário de pico e suporte lento** (Reclame Aqui: Cash Barber,
   AppBarber, BestBarbers).
5. **Página genérica.** A página da maioria é um template com a cor trocada e não parece
   a marca que o dono construiu no Instagram.

---

## 4. Diferencial proposto: três pilares

### Pilar 1: "Sua cara, pronta em 10 minutos" (IA de identidade como **ferramenta de venda**)

O diferencial real não é a página bonita. É a **demonstração antes da assinatura**:

- O vendedor (ou o próprio dono, no self-service) pede **3 a 5 fotos e o logo pelo
  WhatsApp** e, em poucos minutos, mostra a página de agendamento já com a cara da marca,
  com serviços de exemplo e QR code.
- Nenhum concorrente encontrado faz isso. Todos mostram uma demo genérica.
- Isso transforma o modelo da spec ("superadmin cadastra o tenant") em **onboarding feito
  por nós**, que é um argumento forte para o público pouco digital (barbeiro, nail
  designer, sobrancelha).

⚠️ **Limite legal:** gerar prévias a partir do Instagram público de um prospect **sem
autorização** contraria a própria spec (seção 3) e as regras da Meta. Pela API oficial
(Instagram Login, escopo `instagram_business_basic`), só se leem dados de contas
profissionais que **autorizarem** o app, e isso exige App Review. Portanto o caminho
padrão é **upload manual com consentimento**. O Instagram oficial fica como conveniência.

### Pilar 2: "Se paga cortando as faltas" (argumento de ROI)

- **Sinal via Pix no agendamento** (configurável: % ou valor fixo, por serviço) +
  confirmação no WhatsApp + liberação automática do horário se o cliente não confirmar.
- Painel mostrando **"faltas evitadas / R$ protegidos este mês"**. É o número que faz o
  dono renovar a assinatura.
- Isso exige **trazer o sinal Pix da Fase 2 para o MVP** (ver seção 5).

### Pilar 3: "Sem comissão, sem surpresa, o cliente é seu"

- Sem marketplace e sem concorrentes na página do salão. Zero comissão por cliente.
- **WhatsApp incluído no plano** até uma franquia clara, em vez de vendido como adicional.
  ⚠️ A Meta cobra por mensagem de template na Cloud API. É preciso **verificar a tabela
  atual para o Brasil** e embutir o custo no preço do plano.
- Exportação da base de clientes a qualquer momento (o que também atende a LGPD, já
  prevista na spec).

### O que **não** usar como argumento central

- "Tem IA no WhatsApp" (vários concorrentes já têm).
- "Gestão completa" (Trinks e AppBarber ganham em profundidade: estoque, comanda,
  comissão).
- "Mais barato" (há planos grátis; guerra de preço não é viável).

---

## 5. Impacto na especificação (sugestões antes de desenvolver)

| Item da spec | Sugestão |
|---|---|
| §18 Instagram obrigatório ou upload manual? | **Upload manual como padrão.** Instagram oficial é opcional (Fase 2). |
| §18 IA automática ou revisão? | **Revisão obrigatória** (já recomendado na spec). |
| §18 Sinal no MVP ou Fase 2? | **MVP.** É o pilar de ROI. Começar com Pix via um único PSP. |
| §18 Modelo de cobrança | Por faixa de profissionais (padrão do mercado) **com WhatsApp incluído** até uma franquia. |
| §18 Número de WhatsApp | Número do próprio tenant (já previsto); oferecer configuração assistida no onboarding. |
| §15 MVP | Acrescentar: **prévia de marca em < 10 min** como critério de aceite, e métrica **"faltas evitadas"** no dashboard. |
| §10 Superadmin | Criar o fluxo **"gerar prévia para prospect"**: um tenant em rascunho, não publicado, com expiração automática. |
| §16 Critérios de aceite | Acrescentar teste de carga em pico (sábado de manhã), já que a instabilidade é a reclamação nº 1 contra os concorrentes. |

---

## 6. Perguntas em aberto

1. Público inicial: barbearia, salão, nail/sobrancelha? (Barbearia é o segmento mais
   disputado. Nail e sobrancelha, com profissional solo e muito Instagram, combinam
   melhor com o Pilar 1.)
2. Venda assistida (vendedor + onboarding feito por nós) ou self-service desde o início?
3. Qual PSP para Pix (Mercado Pago, Asaas, Efí, Pagar.me)? Isso impacta a taxa repassada.
4. Faixa de preço-alvo? Sugestão para validar: competir na faixa de R$ 50 a R$ 130 com
   WhatsApp e sinal incluídos, e não no "grátis".

---

## Fontes

- [Trinks — Planos e preços](https://negocios.trinks.com/planos/)
- [Simples Agenda — preços](https://www.simplesagenda.com.br/site/sistema-para-barbearia)
- [GENDA — comparativo com preços](https://genda.work/melhor-sistema-para-barbearia)
- [Barbeiro.app — melhor sistema 2026](https://www.barbeiro.app/blog/melhor-sistema-para-barbearia-2026)
- [Barbeiro.app — alternativa ao Trinks](https://www.barbeiro.app/alternativas/trinks)
- [TopAgenda — comparativo](https://topagenda.online/melhores-apps-para-barbearia)
- [ZapCorte — melhor app 2026](https://blog.zapcorte.com.br/melhor-app-de-agendamento-para-barbearia-em-2026-mn4o4n2p)
- [Agende-me — comparativo de sistemas](https://agende-me.com/comparacao-sistemas-agendamento/)
- [Agende-me](https://agende-me.com/)
- [Belio — guia 2026](https://blog.belio.com.br/artigos/software-agendamento-barbearia-2026/)
- [Fresha — Marketplace new client fees](https://www.fresha.com/help-center/knowledge-base/billing-and-fees/101357-marketplace-new-client-fees)
- [Pabau — Fresha pricing](https://pabau.com/blog/fresha-pricing/)
- [Reclame Aqui — Cash Barber (travamentos)](https://www.reclameaqui.com.br/cash-barber/sistema-de-agendamento-de-barbearia-com-travamentos-e-suporte-ineficiente_Yyf1Kazu4GYKm9LL/)
- [Reclame Aqui — App Barber](https://www.reclameaqui.com.br/app-barber/app-barber-nao-cumpre-o-que-promete-falhas-no-agendamento-estoque-e-controle-de-pacotes_YQQypRdlbb6F1pEr/)
- [Reclame Aqui — BestBarbers](https://www.reclameaqui.com.br/bestbarbers/nao-consigo-agendar-o-servico-mesmo-pagando-assinatura_e7DzFHWiAEu7LcBU/)
- [Atendente.AI — Beleza](https://www.atendente.ai/salao-beleza)
- [BestBarbers — Agente IA](https://www.bestbarbers.app/agente-ia-whatsapp)
- [RobotiZap](https://www.robotizap.com/)
- [Barberia.io](https://barberia.io/)
- [SempreAqui](https://usesempreaqui.tech/)
- [IA para barbearia 2026 (custos)](https://eupresa.ia.br/blog/ia-para-barbearia-2026/)
- [Deck Barber](https://www.deckbarber.com.br/)
- [udiAgenda](https://udiagenda.com/)
- [agendamento.link](https://agendamento.link/sistema/)
- [Minha Agenda Virtual](https://www.minhaagendavirtual.com.br/cuidados-pessoais/)
- [Cliente Preferido — reduzir faltas](https://clientepreferido.com.br/blog/como-reduzir-faltas-salao-beleza)
- [Cliente Preferido — sinal via Pix](https://clientepreferido.com.br/blog/como-cobrar-sinal-agendamento-pix)
- [PegaHorário — reduzir faltas](https://pegahorario.com.br/blog/como-reduzir-faltas-clientes)
- [CresciQ — custo do no-show](https://cresciq.com/blog/custo-invisivel-no-show-brasil)
- [Meta — Instagram Platform overview](https://developers.facebook.com/documentation/instagram-platform/overview)
- [Meta — Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Meta — App Review](https://developers.facebook.com/documentation/instagram-platform/app-review)
