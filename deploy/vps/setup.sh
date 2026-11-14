#!/usr/bin/env bash
# Instalação do Amser numa VPS Ubuntu (Hostinger, Hetzner…) com um comando só.
# Rode como root:
#   curl -fsSL https://raw.githubusercontent.com/rodrigoBrandaoDeSouza/amser/main/deploy/vps/setup.sh | ADMIN_EMAIL=voce@email.com bash
#
# CONVIVE com outra aplicação na mesma VPS:
#   - não liga nem reconfigura firewall (só adiciona liberações se o ufw já estiver ativo e o Amser
#     for dono das portas 80/443);
#   - se as portas 80/443 já estão em uso, NÃO as toma: o Amser escuta só em 127.0.0.1:<porta livre>
#     e, se o servidor web for o Nginx, ganha um site próprio (testado com "nginx -t" antes de
#     recarregar; se o teste falhar, nada é alterado);
#   - containers com limite de memória e marcados para morrer primeiro se faltar memória;
#   - nada fora de /opt/amser, dos volumes amser_* e do site do Nginx do Amser é alterado.
#
# Variáveis opcionais (antes do "bash"):
#   DOMAIN=app.seudominio.com.br   domínio apontado (registro A) para o IP da VPS.
#                                  Sem ele, usa app.<ip>.sslip.io (grátis, com HTTPS).
#   WHATSAPP=mock|meta             padrão mock (modo de teste: nada é enviado de verdade).
#   ADMIN_PASSWORD=...             senha do superadmin (12+). Sem ela, é gerada e mostrada no fim.
#   SEED_DEMO=1                    carrega as empresas de demonstração (senha pública amser-dev-123!).
#   NGINX=0                        no modo compartilhado, não mexe no Nginx (só mostra a configuração).
#   CHECK_ONLY=1                   só diagnostica e mostra o que faria; não altera nada.
# Pode rodar de novo: atualiza o código e reaproveita o .env existente.
set -euo pipefail

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
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
CHECK_ONLY="${CHECK_ONLY:-0}"

envget() { [ -f "$DIR/.env" ] && grep -E "^$1=" "$DIR/.env" | tail -n1 | cut -d= -f2- || true; }

# Quem está ouvindo numa porta TCP (vazio = livre). Inclui portas publicadas por containers.
port_holder() {
  local p="$1" h
  h="$(ss -ltnpH "sport = :$p" 2>/dev/null | head -n1 || true)"
  if [ -z "$h" ] && command -v docker >/dev/null; then
    h="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "(0\.0\.0\.0|127\.0\.0\.1|\[::\]|:::):$p->" | head -n1 || true)"
  fi
  printf '%s' "$h"
}
amser_owns_web() { docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'amser-prod-caddy-1'; }

# ---------------------------------------------------------------------------
say "Diagnóstico da VPS"
IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
[ -n "$IP" ] || die "Não consegui descobrir o IP público."
DOMAIN="${DOMAIN:-$(envget APP_DOMAIN)}"
DOMAIN="${DOMAIN:-app.${IP//./-}.sslip.io}"
MEM_TOTAL=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
MEM_AVAIL=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
DISK_FREE=$(df -Pm / | awk 'NR==2{print $4}')
info "IP: $IP · domínio do Amser: $DOMAIN"
info "Memória: ${MEM_AVAIL} MB livres de ${MEM_TOTAL} MB · swap: ${SWAP_MB} MB · disco livre: $((DISK_FREE / 1024)) GB"

[ "$DISK_FREE" -ge 6000 ] || die "Pouco disco livre (precisa de ~6 GB para a imagem e o banco)."
# O Amser usa até ~2 GB (limites dos containers) e o build pede ~1,5 GB por alguns minutos.
if [ "$MEM_AVAIL" -lt 1800 ] && [ "${FORCE:-0}" != "1" ]; then
  die "Só ${MEM_AVAIL} MB de memória livre. Subir o Amser pode deixar a outra aplicação lenta. Aumente a VPS ou rode com FORCE=1 (por sua conta)."
fi

MODE="$(envget COMPOSE_PROFILES)"
if [ -f "$DIR/.env" ]; then
  [ "$MODE" = "proxy" ] && MODE=proxy || MODE=shared
else
  H80="$(port_holder 80)"; H443="$(port_holder 443)"
  if [ -z "$H80" ] && [ -z "$H443" ]; then
    MODE=proxy
    info "Portas 80/443 livres: o Amser cuida do HTTPS sozinho (Caddy)."
  else
    MODE=shared
    info "Portas 80/443 já em uso pela outra aplicação — o Amser NÃO vai tocá-las:"
    [ -n "$H80" ] && info "  80:  $H80"
    [ -n "$H443" ] && info "  443: $H443"
  fi
fi
if [ "$MODE" = proxy ] && ! amser_owns_web; then
  for p in 80 443; do [ -z "$(port_holder $p)" ] || die "A porta $p foi ocupada por outro serviço: $(port_holder $p)"; done
fi

APP_PORT="$(envget APP_PORT)"
if [ -z "$APP_PORT" ]; then
  for p in $(seq 3010 3099); do [ -z "$(port_holder "$p")" ] && APP_PORT=$p && break; done
fi
[ -n "$APP_PORT" ] || die "Nenhuma porta livre entre 3010 e 3099."

NGINX_ACTIVE=0
systemctl is-active --quiet nginx 2>/dev/null && NGINX_ACTIVE=1
if [ "$MODE" = shared ]; then
  if [ "$NGINX_ACTIVE" = 1 ] && [ "${NGINX:-1}" = 1 ]; then
    info "Servidor web: Nginx — será criado só um site novo para $DOMAIN."
    if nginx -T 2>/dev/null | grep -E "^\s*server_name\s" | grep -qw -- "$DOMAIN" && [ ! -f /etc/nginx/sites-available/amser ] && [ ! -f /etc/nginx/conf.d/amser.conf ]; then
      die "O Nginx já tem um site com o nome $DOMAIN. Use outro DOMAIN."
    fi
  else
    info "Servidor web: não é o Nginx do sistema (ou NGINX=0). No fim, mostro como apontar $DOMAIN para 127.0.0.1:$APP_PORT."
  fi
fi
info "Modo: $([ "$MODE" = proxy ] && echo "VPS só do Amser (Caddy nas portas 80/443)" || echo "compartilhado (Amser em 127.0.0.1:$APP_PORT)")"

if [ "$CHECK_ONLY" = "1" ]; then
  say "CHECK_ONLY=1: nada foi alterado. Para instalar, rode o mesmo comando sem CHECK_ONLY."
  exit 0
fi

# ---------------------------------------------------------------------------
say "1/6 Pacotes e Docker"
export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=300"
$APT update -qq
$APT install -y -qq git openssl curl ca-certificates cron >/dev/null
if ! command -v docker >/dev/null; then
  info "Instalando o Docker (não altera serviços que já rodam)…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null || die "Docker Compose não disponível."
systemctl enable --now docker >/dev/null 2>&1 || true

if [ "$SWAP_MB" -lt 1024 ] && [ ! -f /swapfile ]; then
  info "Criando 2 GB de swap (memória de reserva; protege a outra aplicação durante o build)…"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if [ "$MODE" = proxy ] && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
fi

say "2/6 Código do Amser ($DIR)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

say "3/6 Configuração (.env)"
NEW_PASSWORD=""
if [ ! -f .env ]; then
  : "${ADMIN_EMAIL:?Defina ADMIN_EMAIL=seu@email (login do superadmin)}"
  rnd() { openssl rand -base64 "$1" | tr -d '\n/+='; }
  if [ -z "${ADMIN_PASSWORD:-}" ]; then ADMIN_PASSWORD="$(rnd 18)"; NEW_PASSWORD="$ADMIN_PASSWORD"; fi
  [ "${#ADMIN_PASSWORD}" -ge 12 ] || die "ADMIN_PASSWORD precisa de 12+ caracteres."
  umask 077
  cat > .env <<EOF
# Gerado por deploy/vps/setup.sh em $(date -Is). Depois de editar: $COMPOSE up -d
# proxy = Caddy cuida das portas 80/443; vazio = VPS compartilhada (servidor web existente encaminha)
COMPOSE_PROFILES=$([ "$MODE" = proxy ] && echo proxy || true)
APP_PORT=$APP_PORT
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
# mock = modo de teste (nada sai de verdade). WhatsApp oficial: meta + WHATSAPP_APP_SECRET (+ WHATSAPP_APP_ID/WHATSAPP_ES_CONFIG_ID).
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
  info ".env já existe: mantido (edite em $DIR/.env)."
fi

say "4/6 Subindo o Amser (o primeiro build leva alguns minutos)"
# Build num construtor isolado com limite de memória e prioridade baixa de CPU, para não
# deixar a outra aplicação lenta nem disputar memória com ela.
if docker buildx inspect amser-builder >/dev/null 2>&1 || docker buildx create --name amser-builder --driver docker-container \
  --driver-opt memory=1536m --driver-opt memory-swap=3072m --driver-opt cpu-shares=256 >/dev/null 2>&1; then
  docker buildx build --builder amser-builder --load -t amser-app:local .
  docker buildx stop amser-builder >/dev/null 2>&1 || true   # libera a memória do construtor
else
  warn "Construtor limitado indisponível; usando o build padrão do Docker."
  $COMPOSE build
fi
$COMPOSE up -d

printf '    Aguardando o app ficar saudável'
status=""
for _ in $(seq 1 90); do
  status="$(docker inspect -f '{{.State.Health.Status}}' amser-prod-app-1 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  printf '.'; sleep 4
done
echo
[ "$status" = "healthy" ] || { $COMPOSE logs --tail 60 app; die "O app não ficou saudável. Veja o log acima (configuração inválida aparece explicada)."; }

say "5/6 Endereço público (HTTPS)"
NGINX_NOTE=""
if [ "$MODE" = shared ]; then
  if [ "$NGINX_ACTIVE" = 1 ] && [ "${NGINX:-1}" = 1 ]; then
    if [ -d /etc/nginx/sites-enabled ] && nginx -T 2>/dev/null | grep -q "sites-enabled"; then
      SITE=/etc/nginx/sites-available/amser; LINK=/etc/nginx/sites-enabled/amser
    else
      SITE=/etc/nginx/conf.d/amser.conf; LINK=""
    fi
    if [ ! -f "$SITE" ]; then
      cat > "$SITE" <<EOF
# Amser — gerado por $DIR/deploy/vps/setup.sh. Só responde por $DOMAIN.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 30m;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 60s;
    }
}
EOF
      [ -n "$LINK" ] && ln -sf "$SITE" "$LINK"
      if ! nginx -t >/dev/null 2>&1; then
        rm -f "$SITE" ${LINK:+"$LINK"}
        nginx -t || true
        die "A configuração do Nginx não passou no teste; desfiz a alteração (nada mudou na outra aplicação)."
      fi
      systemctl reload nginx
      info "Site do Amser adicionado ao Nginx ($SITE)."
    else
      info "Site do Amser no Nginx já existe ($SITE)."
    fi
    if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
      command -v certbot >/dev/null || $APT install -y -qq certbot python3-certbot-nginx >/dev/null
      if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$(envget ACME_EMAIL)" --redirect >/tmp/amser-certbot.log 2>&1; then
        warn "Não consegui emitir o HTTPS (veja /tmp/amser-certbot.log). Confira se $DOMAIN aponta para $IP."
      fi
    fi
  else
    NGINX_NOTE=1
  fi
fi

printf '    Testando https://%s' "$DOMAIN"
ok=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
  printf '.'; sleep 5
done
echo
[ -n "$ok" ] || warn "https://$DOMAIN ainda não responde.$([ -n "$NGINX_NOTE" ] && echo " Falta encaminhar o domínio (instruções abaixo).")"

if [ "${SEED_DEMO:-0}" = "1" ]; then
  warn "Carregando dados de demonstração (usuários com senha pública amser-dev-123)."
  $COMPOSE exec -T -e NODE_ENV=development app npx tsx prisma/seed.ts || warn "seed falhou"
fi

say "6/6 Backup diário (03:30)"
chmod +x deploy/vps/backup.sh
{ crontab -l 2>/dev/null | grep -v 'deploy/vps/backup.sh' || true; echo "30 3 * * * $DIR/deploy/vps/backup.sh >> /var/log/amser-backup.log 2>&1"; } | crontab -

say "Pronto!"
cat <<EOF

  Endereço:     https://$DOMAIN
  Superadmin:   https://$DOMAIN/login  ($(envget ADMIN_EMAIL))
EOF
[ -n "$NEW_PASSWORD" ] && echo "  Senha:        $NEW_PASSWORD   (anote agora e troque em Minha conta)"
WA="$(envget WHATSAPP_PROVIDER)"
cat <<EOF
  WhatsApp:     $WA$([ "$WA" = mock ] && echo ' (modo de teste: nada é enviado)')
  Interno:      127.0.0.1:$APP_PORT (só nesta máquina)
  Configuração: $DIR/.env
  Atualizar:    rode o mesmo comando de instalação de novo (mantém o .env e os dados)
  Logs:         cd $DIR && $COMPOSE logs -f app
EOF
if [ -n "$NGINX_NOTE" ]; then
  cat <<EOF

  FALTA UM PASSO: o servidor web da outra aplicação ocupa as portas 80/443.
  Configure nele um site para "$DOMAIN" encaminhando para http://127.0.0.1:$APP_PORT,
  repassando os cabeçalhos Host, X-Forwarded-For e X-Forwarded-Proto, com HTTPS para esse domínio.
EOF
fi
echo
