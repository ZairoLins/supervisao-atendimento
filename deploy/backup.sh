#!/usr/bin/env bash
# Backup do PostgreSQL (pg_dump formato custom) + anexos privados, com retenção.
# Uso: deploy/backup.sh            (lê /etc/supervisao/supervisao.env)
# Variáveis: DATABASE_URL, BACKUP_DIR, ATTACHMENTS_DIR, RETENTION_DAYS (padrão 14)
set -euo pipefail
umask 077

ENV_FILE="${ENV_FILE:-/etc/supervisao/supervisao.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

: "${DATABASE_URL:?DATABASE_URL não definida}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/supervisao}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

# pg_dump não aceita o parâmetro "schema" da URL do Prisma
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/supervisao-$STAMP.dump"
TMP="$DUMP.partial"

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$TMP" "$PG_URL"
# Valida o arquivo antes de considerá-lo um backup
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$DUMP"
sha256sum "$DUMP" > "$DUMP.sha256"

if [[ -n "${ATTACHMENTS_DIR:-}" && -d "$ATTACHMENTS_DIR" ]]; then
  tar -czf "$BACKUP_DIR/anexos-$STAMP.tar.gz" -C "$(dirname "$ATTACHMENTS_DIR")" "$(basename "$ATTACHMENTS_DIR")"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'supervisao-*.dump*' -o -name 'anexos-*.tar.gz' \) -mtime +"$RETENTION_DAYS" -delete

echo "Backup concluído: $DUMP"
