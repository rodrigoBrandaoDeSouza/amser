# Publicação em VPS (Hostinger, Hetzner ou similar)

Tudo roda numa máquina só, com Docker:

| Container | O que faz |
|---|---|
| `caddy` | Recebe o tráfego (portas 80/443) e emite HTTPS automático, inclusive para os domínios próprios das empresas |
| `app` | O Amser (Next.js). Aplica as migrations a cada start |
| `worker` | Jobs: lembretes e pedidos de confirmação no WhatsApp, expiração, lista de espera, retenção LGPD |
| `db` | PostgreSQL 16, sem porta aberta para a internet |

As fotos ficam no volume `amser_uploads`, no disco da VPS, que não é apagado. O backup diário inclui o banco e as fotos.

**Tamanho:** 1 vCPU e 4 GB (Hostinger KVM 1) dão conta do começo. O build da imagem leva alguns minutos nessa máquina.

## 1. Contratar e acessar a VPS

1. Na Hostinger, contrate a **VPS** (KVM 1 ou 2). A hospedagem compartilhada não serve. Sistema: **Ubuntu 24.04** (pode ser o modelo "Ubuntu com Docker").
2. Escolha o datacenter no **Brasil** (São Paulo), para ter menor latência.
3. Anote o **IP** e acesse:
   ```bash
   ssh root@SEU_IP
   ```

## 2. Preparar o servidor (uma vez)

```bash
# Atualizações automáticas de segurança
apt update && apt -y upgrade && apt -y install unattended-upgrades git ufw

# Docker (pule se escolheu o modelo com Docker)
curl -fsSL https://get.docker.com | sh

# Firewall: só SSH e web
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Memória extra (evita falta de RAM no build em máquinas de 4 GB)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Domínio

No painel DNS do seu domínio (registro.br, Cloudflare, Hostinger…):

| Tipo | Nome | Valor |
|---|---|---|
| A | `app` (ou `@`) | IP da VPS |

Se usar Cloudflare, deixe a nuvem **cinza** (DNS only). Caso contrário, o HTTPS dos domínios das empresas não funciona.

Espere o DNS propagar: `ping app.seudominio.com.br` deve responder com o IP da VPS.

## 4. Subir o Amser

```bash
git clone https://github.com/<você>/amser.git /opt/amser
cd /opt/amser
cp deploy/vps/env.example .env
nano .env        # preencha domínio, segredos (openssl rand -base64 32), admin e WhatsApp
docker compose -f docker-compose.prod.yml up -d --build
```

Acompanhe a subida:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

- Se faltar alguma configuração, o app **não sobe** e o log mostra exatamente o que corrigir. Depois de corrigir o `.env`, rode o mesmo `up -d`.
- Quando aparecer `[amser] produção — WhatsApp: meta…`, abra `https://app.seudominio.com.br/login` com o `ADMIN_EMAIL`. Em **Minha conta**, troque a senha e ative a verificação em duas etapas.

## 5. WhatsApp (Meta)

Igual ao [deploy.md](deploy.md#2-meta-whatsapp-business-platform). A Callback URL do webhook é `https://app.seudominio.com.br/api/integrations/whatsapp/webhook`.

## 6. Backup diário

```bash
chmod +x /opt/amser/deploy/vps/backup.sh
/opt/amser/deploy/vps/backup.sh          # teste manual
crontab -e
# adicione:
30 3 * * * /opt/amser/deploy/vps/backup.sh >> /var/log/amser-backup.log 2>&1
```

- O backup guarda 14 dias em `/var/backups/amser`.
- **Recomendado:** enviar também para fora da VPS. Crie um bucket no Cloudflare R2 (grátis até 10 GB) e preencha as variáveis `BACKUP_S3_*` no `.env`. Se a VPS sumir, o backup continua existindo.

**Restaurar o banco:**

```bash
cd /opt/amser
docker compose -f docker-compose.prod.yml stop app worker
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U amser -d amser --clean --if-exists < /var/backups/amser/db-AAAAMMDD-HHMM.dump
docker run --rm -v amser_uploads:/data -v /var/backups/amser:/in alpine sh -c "cd /data && tar xzf /in/uploads-AAAAMMDD-HHMM.tgz"
docker compose -f docker-compose.prod.yml start app worker
```

## 7. Atualizar para uma nova versão

```bash
cd /opt/amser && git pull && docker compose -f docker-compose.prod.yml up -d --build
```

As migrations rodam sozinhas no start do app. O site fica fora do ar por alguns segundos enquanto o container troca.

## Domínios próprios das empresas

1. O dono cadastra o domínio no painel (Configurações → Domínio próprio).
2. Ele cria o **CNAME** apontando para `app.seudominio.com.br` e o **TXT** de verificação.
3. Ele clica em verificar.

No primeiro acesso ao domínio, o Caddy pergunta ao app (`/api/tls/ask`) se o domínio foi verificado e só então emite o certificado. Você não precisa fazer nada no servidor.

## Comandos úteis

```bash
cd /opt/amser
docker compose -f docker-compose.prod.yml ps                 # status
docker compose -f docker-compose.prod.yml logs -f worker     # mensagens e jobs
docker compose -f docker-compose.prod.yml restart app
docker compose -f docker-compose.prod.yml exec db psql -U amser amser   # banco
df -h && docker system df                                    # espaço em disco
docker image prune -f                                        # limpa imagens antigas após atualizar
```
