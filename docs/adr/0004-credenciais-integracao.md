# ADR 0004 — Credenciais de integração criptografadas no banco

**Status:** aceita para o MVP · **Data:** 2026-11-13

**Decisão.** Tokens de WhatsApp/PSP ficam em colunas `encrypted_credentials` com AES-256-GCM; a chave (`CREDENTIALS_KEY`) fica em variável protegida do Railway. Nunca são enviados ao navegador: o formulário só substitui o valor.

**Evolução.** Migrar para um cofre gerenciado (ex.: AWS Secrets Manager/KMS) quando houver volume ou exigência de compliance; trocar `crypto.ts` sem mudar o resto do código.
