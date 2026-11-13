# ADR 0005 — Tema visual por IA com structured outputs e aprovação humana

**Status:** aceita · **Data:** 2026-11-13

**Decisão.** `BrandAnalyzer` com dois providers: `mock` (determinístico, dev/testes) e `anthropic` (Claude Opus 5.5 multimodal, `client.messages.parse` + `zodOutputFormat`). A saída é tratada como dado não confiável: schema zod, sanitização de textos, contraste WCAG ≥ 4.5 corrigido automaticamente, índices de imagem mapeados só para mídias existentes. A IA não gera serviços, preços nem depoimentos (o schema nem tem esses campos). Toda versão nasce como rascunho; publicar exige ação humana.

**Fonte das imagens.** Upload manual com confirmação de direitos é o padrão. Instagram oficial (Instagram Login, App Review) fica para a Fase 2. Proibido scraping ou uso de perfis públicos sem autorização.

**Pendente.** Avaliar o esforço (`effort`) e o custo por análise em amostras reais; avaliar fallback em recusas (`stop_reason: "refusal"`) — hoje o usuário recebe mensagem e ajusta manualmente.
