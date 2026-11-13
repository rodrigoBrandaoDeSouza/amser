# ADR 0013 — Autenticação: redefinição de senha, verificação de e-mail e MFA

**Status:** aceita · **Data:** 2026-11-13

- **Tokens de e-mail** de uso único, com 1 h para redefinir senha e 7 dias para verificar o e-mail. No banco fica só o SHA-256 do token. Gerar um novo token invalida os anteriores. A tela "Esqueci a senha" responde sempre igual, para não revelar se o e-mail existe, e tem rate limit.
- **Encerramento de sessões:** trocar ou redefinir a senha grava `sessions_valid_after`. Sessões JWT emitidas antes disso são recusadas.
- **MFA opcional** por TOTP (RFC 6238: SHA-1, 30 s, 6 dígitos, ±1 passo), testado com os vetores oficiais. O segredo fica criptografado (AES-GCM). O login vira duas etapas, com cookie de 5 min só para o segundo passo e rate limit de tentativas.
- **E-mail:** provider `console` em dev ou SMTP em produção (qualquer provedor).
- **Modo suporte:** superadmin só entra no painel de uma empresa com autorização vigente do dono (2 h, 24 h ou 3 dias). A sessão de suporte dura no máximo 2 h e tudo fica na auditoria com o id do superadmin.

**Pendências.** Códigos de recuperação de MFA e bloqueio de reutilização do mesmo código TOTP dentro da janela.
