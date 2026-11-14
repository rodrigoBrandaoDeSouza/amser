#!/bin/sh
# Backup diário do Amser na VPS: banco (pg_dump) + fotos.
# Guarda 14 dias em /var/backups/amser e, se configurado, envia para o R2.
# Agende no cron (crontab -e):  30 3 * * * /opt/amser/deploy/vps/backup.sh >> /var/log/amser-backup.log 2>&1
set -eu

cd "$(dirname "$0")/../.."
DIR="${BACKUP_DIR:-/var/backups/amser}"
TS="$(date +%Y%m%d-%H%M)"
mkdir -p "$DIR"

# Variáveis opcionais do R2 (lidas do .env sem executá-lo)
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed 's/^"//;s/"$//'; }
BUCKET="$(getenv BACKUP_S3_BUCKET)"

echo "[$(date -Is)] backup $TS"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U amser -Fc amser > "$DIR/db-$TS.dump"
docker run --rm -v amser_uploads:/data:ro -v "$DIR":/out alpine tar czf "/out/uploads-$TS.tgz" -C /data .

# Confere se o dump não veio vazio
[ -s "$DIR/db-$TS.dump" ] || { echo "ERRO: dump vazio"; exit 1; }

find "$DIR" -type f -mtime +14 -delete

if [ -n "$BUCKET" ]; then
  docker run --rm -v "$DIR":/out \
    -e AWS_ACCESS_KEY_ID="$(getenv BACKUP_S3_ACCESS_KEY_ID)" \
    -e AWS_SECRET_ACCESS_KEY="$(getenv BACKUP_S3_SECRET_ACCESS_KEY)" \
    -e AWS_DEFAULT_REGION=auto \
    amazon/aws-cli s3 cp /out/ "s3://$BUCKET/$TS/" --recursive --exclude "*" \
      --include "db-$TS.dump" --include "uploads-$TS.tgz" \
      --endpoint-url "$(getenv BACKUP_S3_ENDPOINT)"
  echo "enviado para s3://$BUCKET/$TS/"
fi
echo "ok"
