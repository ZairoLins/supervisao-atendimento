#!/usr/bin/env bash
# Cria um usuário (ou redefine a senha com --reset) no servidor instalado por instalar.sh.
# A senha é digitada de forma oculta.
#   sudo bash /opt/supervisao/app/deploy/criar-usuario.sh supervisor "Nome Completo"
#   sudo bash /opt/supervisao/app/deploy/criar-usuario.sh supervisor --reset
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Execute como root (sudo)."; exit 1; }
LOGIN="${1:?Informe o login}"
shift
EXTRA=()
if [[ "${1:-}" == "--reset" ]]; then EXTRA=(--reset); elif [[ -n "${1:-}" ]]; then EXTRA=(--name "$1"); fi
[[ -n "${2:-}" ]] && EXTRA+=(--role "$2")

exec sudo -u supervisao -H env -i HOME=/opt/supervisao TERM="${TERM:-xterm}" PATH="/opt/supervisao/node/bin:/usr/bin:/bin" \
  bash -c 'set -a; . /etc/supervisao/supervisao.env; set +a; cd /opt/supervisao/app; exec node node_modules/tsx/dist/cli.mjs scripts/create-user.ts --username "$@"' \
  _ "$LOGIN" "${EXTRA[@]}"
