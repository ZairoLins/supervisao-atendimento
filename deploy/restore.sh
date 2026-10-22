#!/usr/bin/env bash
# Restauração REAL do banco a partir de um dump (substitui os dados atuais).
# Procedimento: pare o serviço, faça um backup de segurança do estado atual,
# restaure e reinicie. Uso: sudo deploy/restore.sh /var/backups/supervisao/supervisao-AAAAMMDD-HHMMSS.dump
set -euo pipefail

DUMP="${1:?Informe o arquivo .dump}"
ENV_FILE="${ENV_FILE:-/etc/supervisao/supervisao.env}"
set -a; source "$ENV_FILE"; set +a
: "${DATABASE_URL:?DATABASE_URL não definida}"
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')"

if [[ -f "$DUMP.sha256" ]]; then sha256sum --check "$DUMP.sha256"; fi
pg_restore --list "$DUMP" > /dev/null

read -r -p "Isto substituirá os dados atuais por $DUMP. Digite RESTAURAR para continuar: " CONFIRM
[[ "$CONFIRM" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

systemctl stop supervisao
echo "Backup de segurança do estado atual..."
ENV_FILE="$ENV_FILE" "$(dirname "$0")/backup.sh"

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$PG_URL" "$DUMP"
systemctl start supervisao
echo "Restauração concluída e serviço reiniciado."
