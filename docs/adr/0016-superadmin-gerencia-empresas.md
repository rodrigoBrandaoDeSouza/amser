# ADR 0016 — Superadmin gerencia qualquer empresa sem autorização prévia do dono

**Status:** aceita · **Data:** 2026-11-14 · Substitui o item "Modo suporte" da ADR 0013

**Contexto.** Na ADR 0013, o superadmin só entrava no painel de uma empresa se o dono liberasse antes (2 h, 24 h ou 3 dias, em Configurações). Na prática, a equipe Amser configura as empresas para os clientes (serviços, equipe, marca, WhatsApp). Exigir que o dono libere o acesso a cada vez trava o onboarding e o suporte, e a alternativa (entrar com a senha do cliente) é pior: não fica claro na auditoria quem fez o quê.

**Decisão.**
- **Acesso:** o superadmin entra no painel de qualquer empresa **não excluída**, inclusive suspensa, pelo botão **Gerenciar** (lista de empresas ou página da empresa no admin). Não precisa de autorização do dono. Prévias de prospect continuam no fluxo próprio do admin.
- **Permissões:** ele age como dono (acesso total), mas toda ação fica na **auditoria com o id dele**, nunca com o do dono. Ele não vê a página "Minha conta" do dono.
- **Sessão:** a sessão de gestão dura até 12 h. **Voltar ao admin** encerra a gestão e registra `support.exit`.
- **Visibilidade:** uma faixa roxa fixa no topo do painel mostra qual empresa está sendo gerenciada.
- **Transparência para o dono:** em Configurações, o card **Acessos da equipe Amser** lista os últimos acessos (quem e quando, a partir de `support.enter`) e informa que tudo é registrado.
- A coluna `tenants.support_access_until` deixa de ser usada. Fica no banco (migrations não são editadas) e pode ser removida numa migration futura.

**Consequências.**
- **Termos de uso:** devem prever que a equipe Amser pode acessar o painel para configurar e dar suporte. Para a LGPD, o Amser é operador dos dados dos clientes finais.
- **Segurança da conta:** o risco se concentra na conta de superadmin. Mitigações:
  - verificação em duas etapas (ADR 0013), recomendada como obrigatória para superadmin;
  - auditoria completa;
  - sessão de gestão limitada a 12 h.
- **Interface do dono:** o acesso de suporte com prazo deixa de existir para o dono. Hoje não há opção de bloquear a equipe Amser. Se algum cliente exigir, dá para reintroduzir um bloqueio opcional por empresa.
