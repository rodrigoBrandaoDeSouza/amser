# ADR 0014 — LGPD no CRM: consentimento, portabilidade, eliminação e retenção

**Status:** aceita · **Data:** 2026-11-13

- **Consentimento** do WhatsApp registrado com data e origem (página, recepção, importação, painel). Pode ser revogado pelo cliente ("SAIR") ou pelo dono. O envio checa de novo antes de cada mensagem.
- **Portabilidade:** o dono baixa todos os dados de um cliente em JSON.
- **Eliminação:** anonimização (nome, telefone, e-mail, observações, etiquetas e o telefone gravado no outbox). Agendamentos e pagamentos ficam sem dado pessoal, para manter os números. É recusada se houver agendamento futuro ativo. O telefone pode voltar como cliente novo.
- **Retenção:** prazo configurável por empresa (padrão 24 meses; 0 = desligado). Um job diário anonimiza quem não tem atividade nesse período.
- **Importação CSV:** consentimento só quando a coluna `aceita_whatsapp` diz "sim". O dono declara ter obtido o opt-in.
- Observações do cliente: o painel orienta a não registrar dados de saúde, que são dados sensíveis.
