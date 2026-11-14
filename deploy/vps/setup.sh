#!/usr/bin/env bash
# Instalação do Amser numa VPS Ubuntu (Hostinger, Hetzner…) com um comando só.
# Rode como root:
#   curl -fsSL https://raw.githubusercontent.com/rodrigoBrandaoDeSouza/amser/main/deploy/vps/setup.sh | ADMIN_EMAIL=voce@email.com bash
#
# Variáveis opcionais (antes do "bash"):
#   DOMAIN=app.seudominio.com.br   domínio já apontado (registro A) para o IP da VPS.
#                                  Sem ele, usa app.<ip>.sslip.io (grátis, com HTTPS).
#   WHATSAPP=mock|meta             padrão mock (modo de teste: nada é enviado de verdade).
#   ADMIN_PASSWORD=...             senha do superadmin (12+). Sem ela, é gerada e mostrada no fim.
#   SEED_DEMO=1                    carrega as empresas de demonstração (senha pública amser-dev-123!).
# Pode rodar de novo: atualiza o código e reaproveita o .env existente.
set -euo pipefail

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[aviso] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[erro] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Rode como root (ou com sudo)."
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || warn "Testado em Ubuntu/Debian; você está em ${PRETTY_NAME:-desconhecido}."

REPO="${REPO:-https://github.com/rodrigoBrandaoDeSouza/amser.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/amser}"
WHATSAPP="${WHATSAPP:-mock}"
COMPOSE="docker compose -f docker-compose.prod.yml"

say "1/7 Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ufw openssl curl ca-certificates unattended-upgrades cron >/dev/null

IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
[ -n "$IP" ] || die "Não consegui descobrir o IP público."
DOMAIN="${DOMAIN:-app.${IP//./-}.sslip.io}"

say "2/7 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null || die "Docker Compose não disponível."
systemctl enable --now docker >/dev/null 2>&1 || true

say "3/7 Firewall e memória"
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
ufw allow "${SSH_PORT}/tcp" >/dev/null   # nunca trancar o SSH
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
if ! swapon --show | grep -q . && [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 6000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "4/7 Código do Amser"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

say "5/7 Configuração (.env)"
NEW_PASSWORD=""
if [ ! -f .env ]; then
  : "${ADMIN_EMAIL:?Defina ADMIN_EMAIL=seu@email (login do superadmin)}"
  rnd() { openssl rand -base64 "$1" | tr -d '\n/+=' ; }
  if [ -z "${ADMIN_PASSWORD:-}" ]; then ADMIN_PASSWORD="$(rnd 18)"; NEW_PASSWORD="$ADMIN_PASSWORD"; fi
  [ "${#ADMIN_PASSWORD}" -ge 12 ] || die "ADMIN_PASSWORD precisa de 12+ caracteres."
  umask 077
  cat > .env <<EOF
# Gerado por deploy/vps/setup.sh em $(date -Is). Edite e rode: $COMPOSE up -d
APP_DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
ACME_EMAIL=$ADMIN_EMAIL
POSTGRES_PASSWORD=$(rnd 32)
SESSION_SECRET=$(rnd 48)
CREDENTIALS_KEY=$(openssl rand -base64 32 | tr -d '\n')
JOBS_SECRET=$(rnd 32)
PAYMENT_WEBHOOK_SECRET=$(rnd 32)
BILLING_WEBHOOK_SECRET=$(rnd 32)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
PAYMENT_PROVIDER=none
BILLING_PROVIDER=none
# mock = modo de teste (nada sai de verdade). Para o WhatsApp oficial: meta + os 2 abaixo (+ WHATSAPP_APP_ID/WHATSAPP_ES_CONFIG_ID).
WHATSAPP_PROVIDER=$WHATSAPP
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=$(rnd 24)
WHATSAPP_APP_ID=
WHATSAPP_ES_CONFIG_ID=
STORAGE_PROVIDER=local
INSTAGRAM_PROVIDER=off
BRANDING_AI_PROVIDER=mock
EMAIL_PROVIDER=console
EOF
  umask 022
else
  warn ".env já existe: mantido como está (edite em $DIR/.env)."
  DOMAIN="$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2-)"
fi

# Portas 80/443 livres? (painéis como CloudPanel/Coolify ocupam essas portas)
for port in 80 443; do
  holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -v docker-proxy | head -n1 || true)"
  [ -z "$holder" ] || die "A porta $port já está em uso: $holder — desative esse serviço (ou reinstale a VPS com Ubuntu limpo)."
done

say "6/7 Subindo (o primeiro build leva alguns minutos)"
$COMPOSE up -d --build

printf 'Aguardando o app ficar saudável'
for _ in $(seq 1 90); do
  status="$(docker inspect -f '{{.State.Health.Status}}' amser-prod-app-1 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  printf '.'; sleep 4
done
echo
[ "$status" = "healthy" ] || { $COMPOSE logs --tail 60 app; die "O app não ficou saudável. Veja o log acima (configuração inválida aparece explicada)."; }

printf 'Aguardando o certificado HTTPS'
ok=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
  printf '.'; sleep 5
done
echo
[ -n "$ok" ] || warn "HTTPS ainda não respondeu. Confira se o DNS de $DOMAIN aponta para $IP e veja: $COMPOSE logs caddy"

if [ "${SEED_DEMO:-0}" = "1" ]; then
  warn "Carregando dados de demonstração (usuários com senha pública amser-dev-123)."
  $COMPOSE exec -T -e NODE_ENV=development app npx tsx prisma/seed.ts || warn "seed falhou"
fi

say "7/7 Backup diário (03:30)"
chmod +x deploy/vps/backup.sh
{ crontab -l 2>/dev/null | grep -v 'deploy/vps/backup.sh' || true; echo "30 3 * * * $DIR/deploy/vps/backup.sh >> /var/log/amser-backup.log 2>&1"; } | crontab -

say "Pronto!"
cat <<EOF

  Endereço:     https://$DOMAIN
  Superadmin:   https://$DOMAIN/login  ($(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-))
EOF
[ -n "$NEW_PASSWORD" ] && echo "  Senha:        $NEW_PASSWORD   (anote agora e troque em Minha conta)"
cat <<EOF
  WhatsApp:     $(grep -E '^WHATSAPP_PROVIDER=' .env | cut -d= -f2-) $( [ "$(grep -E '^WHATSAPP_PROVIDER=' .env | cut -d= -f2-)" = mock ] && echo '(modo de teste: nada é enviado)')
  Configuração: $DIR/.env
  Atualizar:    cd $DIR && git pull && $COMPOSE up -d --build
  Logs:         cd $DIR && $COMPOSE logs -f app

EOF
