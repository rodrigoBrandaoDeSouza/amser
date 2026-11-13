# ADR 0009 — Domínio próprio por host

**Status:** aceita · **Data:** 2026-11-13

**Decisão.** `tenant_domains` (máx. 3 por empresa). A posse é provada por TXT em `_amser-verify.<domínio>`. O middleware trata como domínio de cliente todo host fora de `APP_URL`/`APP_HOSTS`/`*.railway.app` e reescreve `/` para `/d/{host}`, que só resolve domínios verificados de empresas ativas. `/api`, `/a/` e `/w/` passam direto, de modo que reserva, gestão e lista de espera funcionam no domínio do cliente. Painel e admin redirecionam para o domínio do Amser (cookies de sessão ficam num só domínio). A URL canônica aponta para o domínio do cliente.

**Pendência.** HTTPS: cada domínio verificado precisa ser adicionado como custom domain no serviço do Railway (hoje manual, pelo superadmin; automatizar via API do Railway).
