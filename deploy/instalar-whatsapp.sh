#!/usr/bin/env bash
# Instala a Evolution API (WhatsApp não oficial) no mesmo servidor da Supervisão.
#   sudo bash /opt/supervisao/app/deploy/instalar-whatsapp.sh
# Idempotente: pode ser executado de novo sem perder a conexão nem as chaves.
#
# O que faz:
#   1. instala o Docker (pacotes do Ubuntu), se ainda não houver;
#   2. gera /etc/supervisao/evolution.env (chave da API e senha do banco, aleatórias);
#   3. sobe a Evolution API + PostgreSQL + Redis (só em 127.0.0.1:8080);
#   4. cria a instância "supervisao" e grava EVOLUTION_* em /etc/supervisao/supervisao.env;
#   5. ativa o timer do aviso automático de reuniões e reinicia a aplicação.
# Depois, conecte o número em Supervisão › WhatsApp (QR Code).
set -euo pipefail

APP_DIR=/opt/supervisao/app
STACK_DIR=/opt/supervisao-whatsapp
EVO_ENV=/etc/supervisao/evolution.env
APP_ENV=/etc/supervisao/supervisao.env
INSTANCE=supervisao
API=http://127.0.0.1:8080

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute com sudo."
[ -f "$APP_ENV" ] || fail "Não encontrei $APP_ENV — a Supervisão está instalada?"
[ -f "$APP_DIR/deploy/whatsapp/docker-compose.yml" ] || fail "Atualize a aplicação antes (deploy/atualizar.sh)."

# Porta 8080 livre (ou já usada por esta instalação)
if ss -ltn '( sport = :8080 )' | grep -q LISTEN && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^supervisao-whatsapp-api'; then
  fail "A porta 8080 já está em uso por outro serviço. Ajuste a porta em deploy/whatsapp/docker-compose.yml."
fi

# 1. Docker
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Instalando Docker (docker.io + docker-compose-v2)…"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
  systemctl enable --now docker >/dev/null
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# 2. Segredos (gerados uma vez; nunca exibidos)
if [ ! -f "$EVO_ENV" ]; then
  KEY=$(openssl rand -hex 24)
  PGPASS=$(openssl rand -hex 24)
  umask 077
  cat >"$EVO_ENV" <<EOF
# Evolution API — gerado por instalar-whatsapp.sh em $(date -Iseconds)
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=$API
AUTHENTICATION_API_KEY=$KEY
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
DEL_INSTANCE=false
LANGUAGE=pt-BR
LOG_LEVEL=ERROR,WARN
LOG_COLOR=false
TELEMETRY_ENABLED=false
CORS_ORIGIN=http://127.0.0.1
CONFIG_SESSION_PHONE_CLIENT=Supervisao
CONFIG_SESSION_PHONE_NAME=Chrome
QRCODE_LIMIT=10
WEBSOCKET_ENABLED=false
RABBITMQ_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:$PGPASS@postgres:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=supervisao
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=false
DATABASE_SAVE_MESSAGE_UPDATE=false
DATABASE_SAVE_DATA_CONTACTS=false
DATABASE_SAVE_DATA_CHATS=false
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://redis:6379/6
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
POSTGRES_USER=evolution
POSTGRES_PASSWORD=$PGPASS
POSTGRES_DB=evolution
EOF
  chmod 600 "$EVO_ENV"
  ok "Segredos gerados em $EVO_ENV (somente root)"
else
  ok "Usando segredos existentes em $EVO_ENV"
fi
KEY=$(grep '^AUTHENTICATION_API_KEY=' "$EVO_ENV" | cut -d= -f2-)

# 3. Containers
install -d -m 755 "$STACK_DIR"
install -m 644 "$APP_DIR/deploy/whatsapp/docker-compose.yml" "$STACK_DIR/docker-compose.yml"
docker compose -f "$STACK_DIR/docker-compose.yml" pull -q
docker compose -f "$STACK_DIR/docker-compose.yml" up -d --remove-orphans
printf 'Aguardando a Evolution API'
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$API/"; then break; fi
  printf '.'
  sleep 3
done
echo
curl -fsS -o /dev/null "$API/" || fail "A Evolution API não respondeu. Veja: docker compose -f $STACK_DIR/docker-compose.yml logs api"
ok "Evolution API em $API (apenas local)"

# 4. Instância
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" "$API/instance/connectionState/$INSTANCE")
if [ "$STATUS" = "200" ]; then
  ok "Instância '$INSTANCE' já existe"
else
  curl -fsS -o /dev/null -X POST "$API/instance/create" -H "apikey: $KEY" -H 'Content-Type: application/json' \
    -d "{\"instanceName\":\"$INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true,\"rejectCall\":true,\"groupsIgnore\":false,\"alwaysOnline\":false,\"readMessages\":false,\"syncFullHistory\":false}" \
    || fail "Não foi possível criar a instância."
  ok "Instância '$INSTANCE' criada"
fi

set_env() {
  local name=$1 value=$2
  if grep -q "^$name=" "$APP_ENV"; then
    sed -i "s|^$name=.*|$name=$value|" "$APP_ENV"
  else
    printf '%s=%s\n' "$name" "$value" >>"$APP_ENV"
  fi
}
grep -q '^# WhatsApp' "$APP_ENV" || printf '\n# WhatsApp (Evolution API local)\n' >>"$APP_ENV"
set_env EVOLUTION_API_URL "$API"
set_env EVOLUTION_API_KEY "$KEY"
set_env EVOLUTION_INSTANCE "$INSTANCE"
ok "Variáveis EVOLUTION_* gravadas em $APP_ENV"

# 5. Aviso automático + reinício da aplicação
install -m 644 "$APP_DIR/deploy/supervisao-avisos.service" /etc/systemd/system/supervisao-avisos.service
install -m 644 "$APP_DIR/deploy/supervisao-avisos.timer" /etc/systemd/system/supervisao-avisos.timer
systemctl daemon-reload
systemctl enable --now supervisao-avisos.timer >/dev/null
ok "Timer supervisao-avisos ativo (a cada 10 minutos)"
systemctl restart supervisao.service
ok "Aplicação reiniciada"

cat <<EOF

Pronto. Próximos passos:
  1. Acesse a Supervisão › WhatsApp e leia o QR Code com o WhatsApp do número que fará os envios
     (WhatsApp › Aparelhos conectados › Conectar aparelho).
  2. Cadastre o número do gestor e escolha o grupo do Suporte Interno.
  3. Use "Testar gestor" e "Testar grupo".

Comandos úteis:
  docker compose -f $STACK_DIR/docker-compose.yml ps
  docker compose -f $STACK_DIR/docker-compose.yml logs --tail 50 api
  systemctl list-timers supervisao-avisos.timer
  journalctl -u supervisao-avisos --since today
EOF
