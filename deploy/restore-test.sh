#!/usr/bin/env bash
# Teste de restauração: restaura o dump mais recente (ou o informado) em um banco
# TEMPORÁRIO, confere as tabelas e a contagem de registros, e remove o banco.
# Não altera o banco de produção.
# Uso: deploy/restore-test.sh [arquivo.dump]
# Requer: usuário com permissão CREATEDB (ou ADMIN_URL apontando para um usuário que a tenha).
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/supervisao/supervisao.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi
: "${DATABASE_URL:?DATABASE_URL não definida}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/supervisao}"
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/supervisao-*.dump | head -n 1)}"
[[ -f "$DUMP" ]] || { echo "Dump não encontrado"; exit 1; }

if [[ -f "$DUMP.sha256" ]]; then
  sha256sum --check --status "$DUMP.sha256" || { echo "Checksum inválido: $DUMP"; exit 1; }
fi

BASE_URL="$(printf '%s' "${ADMIN_URL:-$DATABASE_URL}" | sed -E 's/[?&]schema=[^&]*//')"
TEST_DB="supervisao_restore_test_$(date +%s)"
ADMIN_DB_URL="$(printf '%s' "$BASE_URL" | sed -E "s#/[^/?]+(\?|$)#/postgres\1#")"
TARGET_URL="$(printf '%s' "$BASE_URL" | sed -E "s#/[^/?]+(\?|$)#/$TEST_DB\1#")"

cleanup() { psql "$ADMIN_DB_URL" -q -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" || true; }
trap cleanup EXIT

psql "$ADMIN_DB_URL" -q -c "CREATE DATABASE \"$TEST_DB\""
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_URL" "$DUMP"

echo "Restauração de $DUMP em $TEST_DB concluída. Conferência:"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c "
  SELECT 'migracoes' AS item, count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL
  UNION ALL SELECT 'usuarios', count(*) FROM \"User\"
  UNION ALL SELECT 'colaboradores', count(*) FROM \"Employee\"
  UNION ALL SELECT 'ocorrencias', count(*) FROM \"AttendanceOccurrence\"
  UNION ALL SELECT 'metricas', count(*) FROM \"MonthlyMetric\"
  UNION ALL SELECT 'reunioes', count(*) FROM \"Meeting\"
  UNION ALL SELECT 'tarefas', count(*) FROM \"Task\"
  UNION ALL SELECT 'auditoria', count(*) FROM \"AuditLog\";"
echo "OK — o banco temporário será removido."
