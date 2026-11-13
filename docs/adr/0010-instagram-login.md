# ADR 0010 — Importação de fotos via Instagram Login

**Status:** aceita (produção depende de App Review) · **Data:** 2026-11-13 · **Pilar:** 1

**Decisão.** Instagram API with Instagram Login (`instagram_business_basic`), com endpoints conferidos na documentação oficial em 2026-11-13: autorização em `instagram.com/oauth/authorize`, token curto em `api.instagram.com/oauth/access_token` (resposta em `data[]`), token longo de 60 dias em `graph.instagram.com/access_token` e renovação em `/refresh_access_token`, mídia em `graph.instagram.com/v27.0`. O `state` do OAuth é JWT assinado, preso a usuário e tenant, e casado com um nonce em cookie httpOnly. O token fica criptografado (AES-GCM). O dono escolhe as fotos; a URL é buscada de novo na hora do import e o download só é feito de `*.cdninstagram.com`/`*.fbcdn.net` via HTTPS, com limite de tamanho. A autorização OAuth da própria conta conta como confirmação de direitos (`rights_confirmed_by = instagram:<user>`). Vídeos não são importados.

**Restrições.** Só contas profissionais. Para atender contas de terceiros é preciso app do tipo Business e Advanced Access (App Review). `caption` não está documentado para Instagram Login, por isso não é usado. Upload manual continua sendo o padrão.
