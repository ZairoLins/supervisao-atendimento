#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Instalador da Supervisão de Atendimento em servidor Linux que JÁ HOSPEDA outro
# sistema. Princípios:
#   • Node.js próprio em /opt/supervisao/node (não altera o Node do sistema atual)
#   • porta interna e porta pública dedicadas, verificadas antes de usar
#   • arquivo nginx NOVO e isolado; nunca edita configurações existentes
#   • banco e usuário PostgreSQL dedicados
#   • idempotente: pode ser executado novamente sem perder dados
#
# Uso (como root):
#   sudo bash instalar.sh
# Variáveis opcionais (exemplo: sudo APP_PORT=3200 PUBLIC_PORT=9443 bash instalar.sh):
#   REPO_URL      repositório (padrão: git@github.com:ZairoLins/supervisao-atendimento.git)
#   BRANCH        branch (padrão: main)
#   APP_PORT      porta interna do Next.js, só em 127.0.0.1 (padrão: 3100)
#   PUBLIC_PORT   porta HTTPS para a equipe (padrão: 8443)
#   SERVER_NAME   IP ou nome usado no certificado (padrão: primeiro IP do servidor)
#   DATABASE_URL  informe para usar um PostgreSQL EXTERNO (pula a criação local)
#   NODE_VERSION  versão do Node.js privado (padrão: 24.20.0)
#   OPEN_FIREWALL 1 para liberar PUBLIC_PORT no ufw/firewalld automaticamente
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

REPO_URL="${REPO_URL:-git@github.com:ZairoLins/supervisao-atendimento.git}"
BRANCH="${BRANCH:-main}"
APP_PORT="${APP_PORT:-3100}"
PUBLIC_PORT="${PUBLIC_PORT:-8443}"
NODE_VERSION="${NODE_VERSION:-24.20.0}"
OPEN_FIREWALL="${OPEN_FIREWALL:-0}"

APP_USER=supervisao
BASE=/opt/supervisao
APP_DIR=$BASE/app
NODE_DIR=$BASE/node
ENV_DIR=/etc/supervisao
ENV_FILE=$ENV_DIR/supervisao.env
DATA_DIR=/var/lib/supervisao
BACKUP_DIR=/var/backups/supervisao
TLS_DIR=$ENV_DIR/tls
DB_NAME=supervisao
DB_USER=supervisao
# Impressão digital oficial da chave ed25519 do GitHub (docs.github.com)
GITHUB_ED25519_FP="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_end=$'\e[0m'
step() { printf '\n\e[1m▸ %s\e[0m\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$c_ok" "$c_end" "$*"; }
warn() { printf '  %s!%s %s\n' "$c_warn" "$c_end" "$*"; }
die()  { printf '\n%s✗ %s%s\n' "$c_err" "$*" "$c_end" >&2; exit 1; }
trap 'die "Falha na linha $LINENO. Nada do sistema existente foi alterado por esta etapa; corrija e execute novamente."' ERR
has() { command -v "$1" >/dev/null 2>&1; }

# Executa um comando como o usuário da aplicação, com o Node privado e o .env carregado
as_app() {
  sudo -u "$APP_USER" -H env -i HOME="$BASE" PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin" \
    ${https_proxy:+https_proxy="$https_proxy"} ${http_proxy:+http_proxy="$http_proxy"} \
    bash -c "set -a; [ -f '$ENV_FILE' ] && . '$ENV_FILE'; set +a; cd '$APP_DIR' 2>/dev/null || true; $*"
}

port_in_use() { ss -tlnH "sport = :$1" 2>/dev/null | grep -q .; }
port_owner()  { ss -tlnpH "sport = :$1" 2>/dev/null | head -n1; }

# ── 0. Pré-requisitos ────────────────────────────────────────────────────────
step "Verificando pré-requisitos"
[[ $EUID -eq 0 ]] || die "Execute como root: sudo bash instalar.sh"
has systemctl || die "systemd é necessário."
if has apt-get; then PKG=apt; elif has dnf; then PKG=dnf; elif has yum; then PKG=yum; else die "Gerenciador de pacotes não suportado (apt/dnf/yum)."; fi
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64|arm64) NODE_ARCH=arm64 ;; *) die "Arquitetura não suportada: $(uname -m)";; esac
[[ "$APP_PORT" =~ ^[0-9]+$ && "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || die "Portas inválidas."
SERVER_NAME="${SERVER_NAME:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
[[ -n "$SERVER_NAME" ]] || die "Não foi possível detectar o IP. Informe SERVER_NAME=..."
ok "Sistema: $PKG / $(uname -m) / endereço $SERVER_NAME"

pkg_install() {
  if [[ $PKG == apt ]]; then DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@" >/dev/null
  else $PKG install -y -q "$@" >/dev/null; fi
}
[[ $PKG == apt ]] && apt-get update -q >/dev/null
pkg_install git curl ca-certificates openssl tar "$( [[ $PKG == apt ]] && echo xz-utils || echo xz )" sudo
has ss || pkg_install iproute2 2>/dev/null || pkg_install iproute
ok "Ferramentas básicas presentes"

# Portas: livres ou já pertencentes a esta aplicação (reexecução)
ALREADY_INSTALLED=0; [[ -f /etc/systemd/system/supervisao.service ]] && ALREADY_INSTALLED=1
if port_in_use "$APP_PORT" && ! { [[ $ALREADY_INSTALLED == 1 ]] && grep -q -- "-p $APP_PORT" /etc/systemd/system/supervisao.service; }; then
  die "A porta interna $APP_PORT já está em uso: $(port_owner "$APP_PORT"). Use APP_PORT=<outra>."
fi
if port_in_use "$PUBLIC_PORT" && ! grep -qs "listen $PUBLIC_PORT" /etc/nginx/sites-available/supervisao.conf /etc/nginx/conf.d/supervisao.conf; then
  die "A porta pública $PUBLIC_PORT já está em uso: $(port_owner "$PUBLIC_PORT"). Use PUBLIC_PORT=<outra>."
fi
ok "Portas: interna 127.0.0.1:$APP_PORT, pública $PUBLIC_PORT"

# ── 1. Usuário e diretórios ──────────────────────────────────────────────────
step "Usuário de sistema e diretórios"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BASE"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$DATA_DIR" "$DATA_DIR/anexos" "$BACKUP_DIR"
install -d -o root -g "$APP_USER" -m 750 "$ENV_DIR"
ok "Usuário '$APP_USER', $BASE, $DATA_DIR, $BACKUP_DIR"

# ── 2. Node.js privado ───────────────────────────────────────────────────────
step "Node.js $NODE_VERSION privado (não altera o Node do sistema existente)"
NODE_TARGET="$BASE/node-v$NODE_VERSION-linux-$NODE_ARCH"
if [[ ! -x "$NODE_TARGET/bin/node" ]]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  file="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$file" -o "$tmp/$file"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --status) || die "Checksum do Node.js não confere."
  tar -xJf "$tmp/$file" -C "$BASE"
  chown -R root:root "$NODE_TARGET"
fi
ln -sfn "$NODE_TARGET" "$NODE_DIR"
ok "$("$NODE_DIR/bin/node" -v) em $NODE_DIR (npm $("$NODE_DIR/bin/node" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" -v))"

# ── 3. Acesso ao repositório (chave de deploy somente leitura) ───────────────
step "Acesso ao repositório"
if [[ "$REPO_URL" == git@github.com:* ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$BASE/.ssh"
  KEY="$BASE/.ssh/id_ed25519"
  [[ -f "$KEY" ]] || sudo -u "$APP_USER" ssh-keygen -q -t ed25519 -N "" -C "supervisao@$(hostname)" -f "$KEY"
  if ! grep -qs '^github.com ssh-ed25519' "$BASE/.ssh/known_hosts"; then
    line=$(ssh-keyscan -t ed25519 github.com 2>/dev/null | grep '^github.com ssh-ed25519' || true)
    [[ -n "$line" ]] || die "Não foi possível consultar a chave do github.com (rede/proxy?)."
    fp=$(ssh-keygen -lf <(echo "$line") | awk '{print $2}')
    [[ "$fp" == "$GITHUB_ED25519_FP" ]] || die "Impressão digital do GitHub inesperada ($fp). Abortado por segurança."
    echo "$line" | sudo -u "$APP_USER" tee -a "$BASE/.ssh/known_hosts" >/dev/null
  fi
  if ! sudo -u "$APP_USER" -H git ls-remote "$REPO_URL" >/dev/null 2>&1; then
    echo
    echo "  Adicione a chave pública abaixo como *Deploy key* (somente leitura) do repositório:"
    echo "  GitHub › supervisao-atendimento › Settings › Deploy keys › Add deploy key"
    echo
    cat "$KEY.pub"
    echo
    read -r -p "  Pressione Enter depois de adicionar a chave... " _
    sudo -u "$APP_USER" -H git ls-remote "$REPO_URL" >/dev/null 2>&1 || die "O servidor ainda não tem acesso ao repositório."
  fi
fi
ok "Acesso ao repositório confirmado"

if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" -H git -C "$APP_DIR" fetch -q origin "$BRANCH"
  sudo -u "$APP_USER" -H git -C "$APP_DIR" checkout -q "$BRANCH"
  sudo -u "$APP_USER" -H git -C "$APP_DIR" merge -q --ff-only "origin/$BRANCH"
else
  sudo -u "$APP_USER" -H git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
ok "Código em $APP_DIR ($(sudo -u "$APP_USER" git -C "$APP_DIR" log -1 --format='%h %s' | cut -c1-70))"

# ── 4. PostgreSQL ────────────────────────────────────────────────────────────
step "Banco de dados"
existing_env_val() { [[ -f "$ENV_FILE" ]] && sed -nE "s/^$1=\"?([^\"]*)\"?$/\1/p" "$ENV_FILE" | tail -n1; }
DB_URL_EXISTING=$(existing_env_val DATABASE_URL || true)

if [[ -n "${DATABASE_URL:-}" ]]; then
  FINAL_DB_URL="$DATABASE_URL"
  ok "Usando PostgreSQL externo informado em DATABASE_URL"
elif [[ -n "$DB_URL_EXISTING" ]]; then
  FINAL_DB_URL="$DB_URL_EXISTING"
  ok "Mantendo a conexão já configurada em $ENV_FILE"
else
  if ! id postgres >/dev/null 2>&1; then
    # Porta 5432 ocupada sem PostgreSQL nativo (ex.: container): não instala outro servidor
    port_in_use 5432 && die "A porta 5432 já está em uso ($(port_owner 5432)), mas não há PostgreSQL nativo. Crie banco/usuário nesse servidor e rode novamente com DATABASE_URL=postgresql://usuario:senha@host:porta/supervisao?schema=public"
    warn "PostgreSQL não encontrado: instalando (escutando apenas em localhost)"
    if [[ $PKG == apt ]]; then pkg_install postgresql postgresql-contrib
    else pkg_install postgresql-server postgresql-contrib; postgresql-setup --initdb >/dev/null 2>&1 || true; fi
    systemctl enable --now postgresql >/dev/null 2>&1 || systemctl enable --now "postgresql@*" >/dev/null 2>&1 || true
  fi
  sudo -u postgres psql -Atqc "select 1" >/dev/null 2>&1 || die "O PostgreSQL local não respondeu. Verifique 'systemctl status postgresql'."
  PGVER=$(sudo -u postgres psql -Atqc "show server_version_num")
  (( PGVER >= 130000 )) || die "PostgreSQL 13 ou superior é necessário (encontrado $PGVER)."
  DB_PASS=$(openssl rand -hex 24)
  if sudo -u postgres psql -Atqc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -q -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'"
  else
    sudo -u postgres psql -q -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'"
  fi
  sudo -u postgres psql -Atqc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8' TEMPLATE template0"
  sudo -u postgres psql -q -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
  FINAL_DB_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"
  # Autenticação por senha via TCP local apenas para este banco/usuário (se necessário)
  if ! PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -Atqc "select 1" >/dev/null 2>&1; then
    HBA=$(sudo -u postgres psql -Atqc "show hba_file")
    cp -a "$HBA" "$HBA.bak-supervisao-$(date +%s)"
    sed -i "1i host $DB_NAME $DB_USER 127.0.0.1/32 scram-sha-256" "$HBA"
    sudo -u postgres psql -Atqc "select pg_reload_conf()" >/dev/null
    warn "Adicionada 1 linha em $HBA (somente banco '$DB_NAME', usuário '$DB_USER', 127.0.0.1). Backup salvo ao lado."
    PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -Atqc "select 1" >/dev/null || die "Não foi possível conectar com o usuário $DB_USER."
  fi
  ok "Banco '$DB_NAME' e usuário '$DB_USER' dedicados (PostgreSQL $(sudo -u postgres psql -Atqc 'show server_version'))"
fi
has pg_dump || { [[ $PKG == apt ]] && pkg_install postgresql-client || pkg_install postgresql; }

# ── 5. Variáveis de ambiente ─────────────────────────────────────────────────
step "Arquivo de ambiente $ENV_FILE"
SESSION_SECRET_VAL=$(existing_env_val SESSION_SECRET || true)
[[ -n "$SESSION_SECRET_VAL" ]] || SESSION_SECRET_VAL=$(openssl rand -hex 32)
umask 027
cat > "$ENV_FILE.new" <<EOF
# Gerado por deploy/instalar.sh em $(date -Iseconds). Permissão 640 root:$APP_USER.
DATABASE_URL="$FINAL_DB_URL"
SESSION_SECRET="$SESSION_SECRET_VAL"
APP_TIMEZONE="${APP_TIMEZONE:-America/Sao_Paulo}"
SESSION_TTL_HOURS="12"
COOKIE_SECURE="true"
ATTACHMENTS_DIR="$DATA_DIR/anexos"
BACKUP_DIR="$BACKUP_DIR"
EOF
chown root:"$APP_USER" "$ENV_FILE.new"; chmod 640 "$ENV_FILE.new"; mv "$ENV_FILE.new" "$ENV_FILE"
umask 022
ok "Credenciais geradas e protegidas (não exibidas)"

# ── 6. Dependências, migrações e build ───────────────────────────────────────
step "Instalando dependências e gerando o build (pode levar alguns minutos)"
as_app "npm ci --no-audit --no-fund --loglevel=error"
ok "Dependências instaladas"
as_app "npx prisma migrate deploy" | tail -n 2
as_app "npx prisma db seed" | tail -n 1
ok "Migrações e dados de sistema aplicados"
as_app "NODE_ENV=production npx next build" | tail -n 3
ok "Build concluído"

# ── 7. Serviços systemd ──────────────────────────────────────────────────────
step "Serviços systemd"
PG_LOCAL_DEPS=""; systemctl list-unit-files postgresql.service >/dev/null 2>&1 && [[ "$FINAL_DB_URL" == *@127.0.0.1:* ]] && PG_LOCAL_DEPS="postgresql.service"
cat > /etc/systemd/system/supervisao.service <<EOF
[Unit]
Description=Supervisão de Atendimento (Next.js)
After=network-online.target $PG_LOCAL_DEPS
Wants=network-online.target $PG_LOCAL_DEPS

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $APP_PORT
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR $APP_DIR/.next
ReadOnlyPaths=$BACKUP_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/supervisao-backup.service <<EOF
[Unit]
Description=Backup diário e manutenção — Supervisão de Atendimento
After=network-online.target $PG_LOCAL_DEPS

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
EnvironmentFile=$ENV_FILE
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash $APP_DIR/deploy/backup.sh
ExecStartPost=$NODE_DIR/bin/node node_modules/tsx/dist/cli.mjs scripts/maintenance.ts
UMask=0077
EOF
install -m 644 "$APP_DIR/deploy/supervisao-backup.timer" /etc/systemd/system/supervisao-backup.timer
systemctl daemon-reload
systemctl enable supervisao.service supervisao-backup.timer >/dev/null 2>&1
systemctl restart supervisao.service
systemctl start supervisao-backup.timer

for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/login" || true)
  [[ "$code" == 200 ]] && break; sleep 2
done
[[ "${code:-}" == 200 ]] || { journalctl -u supervisao -n 40 --no-pager; die "A aplicação não respondeu em 127.0.0.1:$APP_PORT."; }
ok "Aplicação ativa em 127.0.0.1:$APP_PORT (serviço supervisao)"

# ── 8. Proxy HTTPS (nginx, arquivo isolado) ──────────────────────────────────
step "Proxy HTTPS na porta $PUBLIC_PORT"
if ! has nginx; then
  warn "nginx não encontrado: instalando sem iniciar o site padrão (para não ocupar a porta 80)"
  CREATED_POLICY=0
  if [[ $PKG == apt && ! -e /usr/sbin/policy-rc.d ]]; then printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod +x /usr/sbin/policy-rc.d; CREATED_POLICY=1; fi
  pkg_install nginx
  [[ $CREATED_POLICY == 1 ]] && rm -f /usr/sbin/policy-rc.d
  rm -f /etc/nginx/sites-enabled/default
  if [[ $PKG != apt ]]; then sed -i -E 's/^(\s*listen\s+(\[::\]:)?80)/#&/' /etc/nginx/nginx.conf; fi
  systemctl enable nginx >/dev/null 2>&1
fi

install -d -m 750 "$TLS_DIR"
if [[ ! -f "$TLS_DIR/supervisao.crt" ]]; then
  SAN="DNS:$(hostname)"; [[ "$SERVER_NAME" =~ ^[0-9.]+$ ]] && SAN="$SAN,IP:$SERVER_NAME" || SAN="$SAN,DNS:$SERVER_NAME"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 -subj "/CN=$SERVER_NAME/O=Supervisao" \
    -addext "subjectAltName=$SAN" -keyout "$TLS_DIR/supervisao.key" -out "$TLS_DIR/supervisao.crt" 2>/dev/null
  chmod 600 "$TLS_DIR/supervisao.key"
  ok "Certificado autoassinado gerado ($SAN) — substitua por um da CA interna quando possível"
fi

if [[ -d /etc/nginx/sites-available ]]; then NGX_FILE=/etc/nginx/sites-available/supervisao.conf; else NGX_FILE=/etc/nginx/conf.d/supervisao.conf; fi
[[ -f "$NGX_FILE" ]] && cp -a "$NGX_FILE" "$NGX_FILE.bak"
cat > "$NGX_FILE" <<EOF
# Supervisão de Atendimento — gerado por deploy/instalar.sh (arquivo independente)
server {
    listen $PUBLIC_PORT ssl;
    server_name _;

    ssl_certificate     $TLS_DIR/supervisao.crt;
    ssl_certificate_key $TLS_DIR/supervisao.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    # Acesso HTTP na porta HTTPS: redireciona para https
    error_page 497 =301 https://\$host:\$server_port\$request_uri;

    # Somente redes privadas (LAN/VPN)
    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    allow 127.0.0.1;
    deny all;

    client_max_body_size 12m;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host:\$server_port;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host:\$server_port;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
[[ -d /etc/nginx/sites-enabled ]] && ln -sfn "$NGX_FILE" /etc/nginx/sites-enabled/supervisao.conf
if ! nginx -t >/dev/null 2>&1; then
  nginx -t || true
  rm -f /etc/nginx/sites-enabled/supervisao.conf
  if [[ -f "$NGX_FILE.bak" ]]; then mv "$NGX_FILE.bak" "$NGX_FILE"; else rm -f "$NGX_FILE"; fi
  die "Configuração do nginx inválida — arquivo da Supervisão removido; o nginx existente não foi recarregado."
fi
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi
ok "nginx recarregado (sem reiniciar sites existentes): $NGX_FILE"

if has getenforce && [[ "$(getenforce)" == Enforcing ]]; then
  setsebool -P httpd_can_network_connect 1 || warn "Defina: setsebool -P httpd_can_network_connect 1"
  if has semanage; then semanage port -a -t http_port_t -p tcp "$PUBLIC_PORT" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$PUBLIC_PORT" || true
  else warn "SELinux ativo: rode 'semanage port -a -t http_port_t -p tcp $PUBLIC_PORT'"; fi
fi

code=$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$PUBLIC_PORT/login" || true)
[[ "$code" == 200 ]] && ok "HTTPS respondendo em https://$SERVER_NAME:$PUBLIC_PORT" || warn "HTTPS local retornou $code; verifique 'journalctl -u nginx'"

# ── 9. Firewall ──────────────────────────────────────────────────────────────
step "Firewall"
if has ufw && ufw status | grep -q "Status: active"; then
  if [[ $OPEN_FIREWALL == 1 ]]; then ufw allow "$PUBLIC_PORT/tcp" >/dev/null; ok "ufw: porta $PUBLIC_PORT liberada"
  else warn "ufw ativo. Para liberar: sudo ufw allow $PUBLIC_PORT/tcp"; fi
elif has firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
  if [[ $OPEN_FIREWALL == 1 ]]; then firewall-cmd -q --permanent --add-port="$PUBLIC_PORT/tcp" && firewall-cmd -q --reload; ok "firewalld: porta $PUBLIC_PORT liberada"
  else warn "firewalld ativo. Para liberar: sudo firewall-cmd --permanent --add-port=$PUBLIC_PORT/tcp && sudo firewall-cmd --reload"; fi
else
  ok "Nenhum firewall local ativo detectado"
fi

# ── 10. Primeiro usuário ─────────────────────────────────────────────────────
step "Usuário supervisor"
USERS=$(psql "${FINAL_DB_URL%%\?*}" -Atqc 'select count(*) from "User"' 2>/dev/null || echo "?")
if [[ "$USERS" == 0 ]] && [[ -t 0 ]]; then
  read -r -p "  Login do supervisor (ex.: supervisor): " U
  read -r -p "  Nome completo: " N
  bash "$APP_DIR/deploy/criar-usuario.sh" "$U" "$N"
elif [[ "$USERS" == 0 ]]; then
  warn "Nenhum usuário. Crie com: sudo bash $APP_DIR/deploy/criar-usuario.sh"
else
  ok "Usuários existentes: $USERS"
fi

# ── Resumo ───────────────────────────────────────────────────────────────────
systemctl start supervisao-backup.service >/dev/null 2>&1 && ok "Primeiro backup gerado em $BACKUP_DIR" || warn "Primeiro backup falhou: journalctl -u supervisao-backup"
printf '\n%s✓ Instalação concluída%s\n' "$c_ok" "$c_end"
cat <<EOF

  Endereço para a equipe:  https://$SERVER_NAME:$PUBLIC_PORT
  (certificado autoassinado: o navegador pedirá confirmação no primeiro acesso)

  Serviço:        systemctl status supervisao      | logs: journalctl -u supervisao -f
  Backups:        $BACKUP_DIR (diário 02:30)       | systemctl list-timers supervisao-backup.timer
  Configuração:   $ENV_FILE
  Atualizar:      sudo bash $APP_DIR/deploy/atualizar.sh
  O sistema que já existia no servidor não foi alterado.
EOF
