#!/usr/bin/env bash
# Atualiza a Supervisão de Atendimento para a versão mais recente da branch, sem perda de dados:
# backup → git pull → npm ci → migrações → seed → build → reinício → verificação.
# Se algo falhar antes do reinício, o serviço em execução não é reiniciado; o backup fica em /var/backups/supervisao.
#   sudo bash /opt/supervisao/app/deploy/atualizar.sh
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute como root (sudo)."; exit 1; }

APP_DIR=/opt/supervisao/app
ENV_FILE=/etc/supervisao/supervisao.env
BRANCH="${BRANCH:-main}"
APP_PORT=$(sed -nE 's/.* -p ([0-9]+).*/\1/p' /etc/systemd/system/supervisao.service)

as_app() {
  sudo -u supervisao -H env -i HOME=/opt/supervisao PATH="/opt/supervisao/node/bin:/usr/bin:/bin" \
    bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR'; $*"
}
trap 'echo "✗ Falha na linha $LINENO. Verifique a saída acima; o backup pré-atualização está em /var/backups/supervisao."' ERR

echo "▸ Backup antes da atualização"
systemctl start supervisao-backup.service

echo "▸ Baixando a versão mais recente ($BRANCH)"
BEFORE=$(sudo -u supervisao git -C "$APP_DIR" rev-parse HEAD)
sudo -u supervisao -H git -C "$APP_DIR" fetch -q origin "$BRANCH"
sudo -u supervisao -H git -C "$APP_DIR" merge -q --ff-only "origin/$BRANCH"
AFTER=$(sudo -u supervisao git -C "$APP_DIR" rev-parse HEAD)
if [[ "$BEFORE" == "$AFTER" && "${FORCE:-0}" != 1 ]]; then echo "✓ Já está na versão mais recente ($AFTER)."; exit 0; fi
sudo -u supervisao git -C "$APP_DIR" log --oneline "$BEFORE..$AFTER" | head -n 20

echo "▸ Dependências, migrações e build"
as_app "npm ci --no-audit --no-fund --loglevel=error"
as_app "npx prisma migrate deploy" | tail -n 2
as_app "npx prisma db seed" | tail -n 1
as_app "NODE_ENV=production npx next build" | tail -n 3

echo "▸ Reiniciando o serviço"
systemctl restart supervisao
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/login" || true)
  [[ "$code" == 200 ]] && break; sleep 2
done
[[ "${code:-}" == 200 ]] || { journalctl -u supervisao -n 40 --no-pager; echo "✗ A aplicação não respondeu após a atualização."; exit 1; }
echo "✓ Atualizado de ${BEFORE:0:7} para ${AFTER:0:7}"
