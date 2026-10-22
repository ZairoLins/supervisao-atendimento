# Implantação em servidor Linux interno

Exemplos para Debian/Ubuntu com systemd. Ajuste nomes de host, faixas de rede e caminhos à sua infraestrutura.

## 1. Topologia

- **Aplicação**: Node.js 22+ executando `next start` em `127.0.0.1:3000`, atrás de **nginx** com HTTPS.
- **Banco**: PostgreSQL 14+ em uma das opções:
  - **(A) mesmo servidor** — PostgreSQL escutando apenas em `localhost` (`listen_addresses = 'localhost'`).
  - **(B) servidor dedicado** — PostgreSQL escutando somente na interface da rede de servidores; `pg_hba.conf` liberando **apenas o IP do servidor da aplicação**, com `scram-sha-256` e preferencialmente TLS (`sslmode=require` na URL). Firewall bloqueando a porta 5432 para a rede de usuários.
- Em nenhum caso exponha o PostgreSQL à rede de usuários ou à VPN de usuários.

## 2. Banco de dados

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE supervisao LOGIN PASSWORD 'SENHA_FORTE_GERADA';
CREATE DATABASE supervisao OWNER supervisao ENCODING 'UTF8';
SQL
```

O usuário `supervisao` precisa ser dono do banco para a migração criar a extensão `pg_trgm` (extensão confiável). Para rodar os testes no servidor, crie também `supervisao_test` (opcional).

## 3. Usuário do sistema e diretórios

```bash
sudo useradd --system --home /opt/supervisao --shell /usr/sbin/nologin supervisao
sudo mkdir -p /opt/supervisao/app /var/lib/supervisao/anexos /var/backups/supervisao /etc/supervisao
sudo chown -R supervisao:supervisao /opt/supervisao /var/lib/supervisao /var/backups/supervisao
sudo chmod 700 /var/lib/supervisao/anexos /var/backups/supervisao
```

## 4. Variáveis de ambiente

```bash
sudo cp /opt/supervisao/app/.env.example /etc/supervisao/supervisao.env
sudo editor /etc/supervisao/supervisao.env     # DATABASE_URL, SESSION_SECRET (openssl rand -hex 32), caminhos
sudo chown root:supervisao /etc/supervisao/supervisao.env && sudo chmod 640 /etc/supervisao/supervisao.env
```

Nunca coloque credenciais no código ou no repositório.

## 5. Instalação e build

```bash
# como usuário supervisao, dentro de /opt/supervisao/app (código copiado/clonado)
sudo -u supervisao bash
cd /opt/supervisao/app
set -a; source /etc/supervisao/supervisao.env; set +a
npm ci                       # instala dependências e gera o Prisma Client (postinstall)
npm run db:migrate           # prisma migrate deploy
npm run db:seed              # jornadas padrão e tipos de ocorrência (idempotente)
npm run build
npm run user:create -- --username supervisor --name "Nome do Supervisor"
exit
```

`npm ci` instala também as dependências de desenvolvimento (Prisma CLI e `tsx`), usadas por migração, seed, criação de usuário e manutenção.

## 6. Serviço systemd

```bash
sudo cp deploy/supervisao.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now supervisao
sudo systemctl status supervisao
journalctl -u supervisao -f
```

Se o PostgreSQL estiver no mesmo servidor, descomente `After=/Requires=postgresql.service` no arquivo da unidade.

## 7. Acesso pela rede local ou VPN

- Instale nginx e use `deploy/nginx-supervisao.conf`, com certificado emitido pela CA interna (ou autoassinado distribuído às estações). Mantenha `COOKIE_SECURE="true"`.
- Ajuste os blocos `allow` para a rede interna e a faixa da VPN; o restante recebe 403.
- Crie um registro DNS interno (ex.: `supervisao.empresa.local`).
- Firewall: apenas 443 (e 80 para redirecionamento) abertos para usuários; 3000 somente em `localhost`.
- Acesso externo apenas via VPN corporativa — não publique a aplicação na internet.
- Somente se for inevitável usar HTTP puro em rede confiável, defina `COOKIE_SECURE="false"` (não recomendado).

## 8. Backups automáticos

```bash
sudo chmod +x /opt/supervisao/app/deploy/*.sh
sudo cp deploy/supervisao-backup.service deploy/supervisao-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now supervisao-backup.timer
sudo systemctl start supervisao-backup.service      # primeiro backup imediato
systemctl list-timers supervisao-backup.timer
```

O job diário (02:30): `pg_dump` em formato custom, validação com `pg_restore --list`, checksum SHA-256, cópia compactada dos anexos, retenção de 14 dias (`RETENTION_DAYS`) e limpeza de sessões expiradas. Requer `postgresql-client` da mesma versão major do servidor. **Copie `/var/backups/supervisao` para outro servidor/mídia** (rsync, storage corporativo). A tela *Configurações › Backups* mostra o último backup encontrado em `BACKUP_DIR`.

## 9. Restauração

**Teste periódico (não altera produção):**

```bash
sudo -u supervisao /opt/supervisao/app/deploy/restore-test.sh            # último dump
sudo -u supervisao /opt/supervisao/app/deploy/restore-test.sh arquivo.dump
```

Cria um banco temporário, restaura, confere migrações e contagens das tabelas principais e remove o banco (requer permissão `CREATEDB` ou `ADMIN_URL` com um usuário que a tenha).

**Restauração real:**

```bash
sudo /opt/supervisao/app/deploy/restore.sh /var/backups/supervisao/supervisao-AAAAMMDD-HHMMSS.dump
```

O script confere o checksum, pede confirmação digitada, para o serviço, faz backup de segurança do estado atual, restaura em transação única e reinicia. Anexos: extraia o `anexos-*.tar.gz` correspondente em `/var/lib/supervisao`.

## 10. Atualização sem perda de dados

```bash
sudo systemctl start supervisao-backup.service           # backup antes de atualizar
sudo -u supervisao bash -c '
  cd /opt/supervisao/app && set -a && source /etc/supervisao/supervisao.env && set +a &&
  git pull            # ou copie a nova versão
  npm ci &&
  npm run db:migrate &&   # aplica somente migrações novas; nunca usa migrate dev/reset em produção
  npm run db:seed &&      # idempotente
  npm run build'
sudo systemctl restart supervisao
```

Para reverter: volte o código à versão anterior, rode `npm ci && npm run build` e, se a nova migração tiver alterado dados, restaure o backup feito antes da atualização.

## 11. Verificação pós-implantação

- `https://supervisao.empresa.local/login` carrega; login funciona; *Configurações › Auditoria* registra o login.
- `curl -I https://.../api/pesquisa?q=teste` sem sessão retorna **401**.
- Exportar um relatório Excel e um PDF.
- `systemctl list-timers` mostra o próximo backup; executar `restore-test.sh` uma vez.
