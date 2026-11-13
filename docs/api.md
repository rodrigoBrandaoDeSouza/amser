# API

O painel e o superadmin usam **server actions** (`src/app/painel/actions.ts`, `src/app/admin/actions.ts`), protegidas por sessão e pelo controle de origem do Next. As rotas JSON abaixo são as públicas e de integração.

Erros seguem `{ "error": "<código>", "message": "<texto seguro>" }`. Códigos: `validation` (422), `not_found` (404), `slot_taken`/`slot_unavailable`/`policy` (409), `rate_limited` (429), `payment_unavailable` (503), `internal` (500).

## Página pública

### `GET /api/public/{slug}/availability?serviceId=&date=YYYY-MM-DD[&professionalId=]`
Horários livres (só empresas `active`). Não expõe quais profissionais estão livres.
```json
{ "slots": [{ "startsAt": "2026-11-16T12:00:00.000Z", "label": "09:00" }] }
```
Rate limit: 120/min por IP.

### `POST /api/public/{slug}/appointments`
```json
{ "serviceId": "…", "professionalId": null, "startsAt": "ISO",
  "customer": { "name": "Maria", "phone": "(11) 97777-6666", "email": null, "consentWhatsapp": true } }
```
`201` → `{ "token": "<link do cliente>", "status": "aguardando_sinal" | "pendente", "payment": { "amountCents": 1200, "expiresAt": "ISO" } | null }`.
O servidor revalida o horário, deduplica o cliente por telefone e reserva sob exclusion constraint. Rate limit: 10/10 min por IP e 5/h por telefone.

### `GET /api/public/appointments/{token}` → `{ "status": "…" }`
### `POST /api/public/appointments/{token}`
`{ "action": "confirm" }` · `{ "action": "cancel" }` (→ `{ withinWindow, depositRetained }`) · `{ "action": "reschedule", "startsAt": "ISO" }`.
O token (JWT HS256, `aud=amser:action`) só dá acesso àquele agendamento e expira 7 dias após o horário.

## Integrações

### `POST /api/integrations/payments/{provider}/webhook`
Assinatura obrigatória (mock: header `x-amser-signature` = HMAC-SHA256 do corpo com `PAYMENT_WEBHOOK_SECRET`). Idempotente. Respostas: `confirmed`, `late_payment`, `duplicate`, `ignored`, `expired`; `401` assinatura inválida; `500` → o PSP reenvia.

### `GET /api/integrations/whatsapp/webhook`
Verificação da Meta (`hub.mode`, `hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`, `hub.challenge`).

### `POST /api/integrations/whatsapp/webhook`
Status de entrega. Header `X-Hub-Signature-256` validado com `WHATSAPP_APP_SECRET`. Ignora eventos fora de ordem.

## Operação

| Rota | Uso |
|---|---|
| `POST /api/jobs/run` | `Authorization: Bearer $JOBS_SECRET`. Roda todos os jobs uma vez. |
| `GET /api/health` | Checa o banco. |
| `GET /api/media/{id}` | Imagens de marca de empresas visíveis. |
| `GET /api/painel/clientes/export` | CSV da base (só owner). Proteção contra CSV injection. |
| `POST /api/dev/simulate-pix` | **Somente dev** (404 em produção): simula o PSP confirmando o Pix. |

## Mapeamento com a spec (§16)

| Spec | Implementação |
|---|---|
| `POST /admin/tenants`, `/admin/prospects`, `/convert` | server actions em `/admin` |
| `/tenants/{id}/branding/analyze|preview|publish` | server actions em `/painel/marca` e `/admin/empresas/{id}`; prévia em `/marca-preview/{id}` |
| `GET /public/{slug}/services` | renderizado no servidor em `/{slug}` |
| `GET /preview/{token}` | página `/preview/{token}` |
| `/appointments/{id}/confirm|reschedule|cancel` | `/api/public/appointments/{token}` (cliente) e server actions (equipe) |
| `GET /dashboard/*` | páginas `/painel/*` |
