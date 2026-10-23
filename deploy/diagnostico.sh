#!/usr/bin/env bash
# Diagnóstico SOMENTE LEITURA do servidor antes de instalar a Supervisão de Atendimento.
# Não instala, não altera e não reinicia nada. Uso:  sudo bash diagnostico.sh
# Cole a saída completa na conversa para revisão.
set -uo pipefail

sec() { printf '\n==== %s ====\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }

sec "Sistema"
. /etc/os-release 2>/dev/null && echo "SO: ${PRETTY_NAME:-desconhecido}"
echo "Kernel: $(uname -r) | Arquitetura: $(uname -m)"
echo "Usuário atual: $(id -un) (root: $([[ $EUID -eq 0 ]] && echo sim || echo não))"
has systemctl && echo "systemd: sim" || echo "systemd: NÃO"
for pm in apt-get dnf yum; do has "$pm" && echo "Gerenciador de pacotes: $pm" && break; done

sec "Recursos"
free -h 2>/dev/null | sed -n '1,2p'
df -h / /opt /var 2>/dev/null | awk 'NR==1 || !seen[$0]++'
echo "CPUs: $(nproc 2>/dev/null)"

sec "Portas TCP em uso (escuta)"
if has ss; then ss -tlnpH 2>/dev/null | awk '{print $4, $6}' | sort -u; else netstat -tlnp 2>/dev/null; fi

sec "Node.js / gerenciadores de processo"
has node && echo "node no PATH: $(command -v node) $(node -v)" || echo "node: não encontrado no PATH"
has npm && echo "npm: $(npm -v 2>/dev/null)"
ls -d /root/.nvm /home/*/.nvm 2>/dev/null | sed 's/^/nvm: /'
if has pm2; then echo "pm2: sim"; pm2 ls 2>/dev/null; else echo "pm2: não encontrado (como root)"; fi
for u in $(awk -F: '$3>=1000 && $7 !~ /nologin|false/ {print $1}' /etc/passwd); do
  sudo -u "$u" -H bash -lc 'command -v pm2 >/dev/null && echo "pm2 do usuário '"$u"':" && pm2 ls' 2>/dev/null
done
echo "Processos node em execução:"
ps -eo pid,user,args 2>/dev/null | grep -E '[n]ode|[n]ext' | cut -c1-200 | head -n 20

sec "Serviços systemd relacionados"
has systemctl && systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei 'node|next|pm2|nginx|apache|httpd|caddy|postgres|docker' || true

sec "Docker"
if has docker; then docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}' 2>/dev/null || echo "docker presente (sem permissão para listar)"; else echo "docker: não encontrado"; fi

sec "Servidor web / proxy reverso"
if has nginx; then
  nginx -v 2>&1
  nginx -t 2>&1 | tail -n 2
  echo "Sites/arquivos de configuração:"
  ls -1 /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
  echo "Diretivas listen/server_name/proxy_pass:"
  grep -RhoE '^\s*(listen|server_name|proxy_pass)\s+[^;]+' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sed 's/^\s*//' | sort | uniq -c
else
  echo "nginx: não encontrado"
fi
for w in apache2 httpd caddy; do has "$w" && echo "$w: presente"; done

sec "PostgreSQL"
has psql && echo "cliente psql: $(psql --version)"
has pg_dump && echo "pg_dump: $(pg_dump --version)"
if has pg_lsclusters; then pg_lsclusters; fi
if id postgres >/dev/null 2>&1; then
  sudo -u postgres psql -Atc "select 'versão servidor: '||version()" 2>/dev/null || echo "usuário postgres existe, mas o servidor local não respondeu"
  sudo -u postgres psql -Atc "show listen_addresses" 2>/dev/null | sed 's/^/listen_addresses: /'
  sudo -u postgres psql -Atc "select 'banco existente: '||datname from pg_database where not datistemplate" 2>/dev/null
  sudo -u postgres psql -Atc "select 'pg_trgm disponível: '||count(*) from pg_available_extensions where name='pg_trgm'" 2>/dev/null
else
  echo "PostgreSQL local: não encontrado (usuário 'postgres' inexistente)"
fi

sec "Firewall / SELinux"
has ufw && ufw status 2>/dev/null | head -n 15
has firewall-cmd && firewall-cmd --list-all 2>/dev/null | head -n 15
has getenforce && echo "SELinux: $(getenforce)"

sec "Conectividade"
for h in github.com nodejs.org registry.npmjs.org; do
  if has curl && curl -s -o /dev/null -m 8 -w '%{http_code}' "https://$h" | grep -qE '^[23]'; then echo "$h: OK"; else echo "$h: SEM ACESSO (proxy corporativo?)"; fi
done
[[ -n "${https_proxy:-${HTTPS_PROXY:-}}" ]] && echo "proxy configurado: sim"

sec "Instalação anterior da Supervisão"
id supervisao >/dev/null 2>&1 && echo "usuário supervisao: existe" || echo "usuário supervisao: não existe"
ls -d /opt/supervisao /etc/supervisao 2>/dev/null || echo "diretórios: não existem"

sec "Fim"
echo "Nada foi alterado. Envie esta saída para revisão antes de rodar instalar.sh."
