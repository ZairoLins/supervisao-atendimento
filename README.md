# Supervisão de Atendimento

Aplicação web interna, em português, que centraliza a rotina do supervisor de uma equipe de atendimento: colaboradores, frequência e escalas (incluindo 12x36), métricas mensais, reuniões e atas, feedbacks, anotações, tarefas, relatórios Excel/PDF e **pesquisa global** (Ctrl/⌘+K) em todos os módulos.

Visual baseado na referência *ORYZO AI — Style Reference*, adaptada para software administrativo (fundo Walnut Shadow, tipografia Warm Cream, superfícies Bark Brown, divisórias tracejadas Cork Border e o laranja Ember apenas como acento).

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.4 (App Router, Server Actions, Turbopack), React 19.3 |
| Linguagem | TypeScript 5.9 em modo estrito |
| Banco | PostgreSQL 14+ (testado no 18) com Prisma ORM 7.10 + `@prisma/adapter-pg` |
| UI | Tailwind CSS 4.3, Lucide, Inter (auto-hospedada via `@fontsource-variable/inter`) |
| Gráficos | Recharts 3 |
| Validação | Zod 4 |
| Autenticação | Argon2id (`@node-rs/argon2`) + sessões opacas no banco (padrão recomendado após a descontinuação do Lucia) |
| Relatórios | ExcelJS 4.4, PDFKit 0.20 |
| Testes | Vitest 5 (unidade + integração com PostgreSQL real) |

## Início rápido (desenvolvimento)

Pré-requisitos: Node.js 22+ (testado no 24), PostgreSQL acessível.

```bash
npm install
cp .env.example .env            # edite DATABASE_URL, TEST_DATABASE_URL e SESSION_SECRET
npx prisma migrate dev          # aplica as migrações
npm run db:seed                 # jornadas padrão e tipos de ocorrência (sem usuários)
npm run user:create -- --username supervisor --name "Nome do Supervisor"
npm run dev                     # http://localhost:3000
```

Não existe conta padrão: o primeiro usuário é criado pelo terminal, com senha digitada de forma oculta.

## Comandos

| Comando | Função |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` / `npm start` | build e execução de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | gera tipos de rotas e roda `tsc --noEmit` |
| `npm test` | todos os testes (integração exige `TEST_DATABASE_URL`) |
| `npm run db:test:prepare` | aplica as migrações no banco de testes |
| `npm run db:generate` | gera o Prisma Client |
| `npm run db:migrate` | aplica migrações pendentes (produção — `prisma migrate deploy`) |
| `npm run db:migrate:dev` | cria/aplica migrações em desenvolvimento |
| `npm run db:seed` | carga idempotente de dados de sistema |
| `npm run user:create` | cria usuário ou redefine senha (`--reset`) |
| `npm run maintenance` | remove sessões expiradas e tentativas de login antigas |

## Variáveis de ambiente

Veja [.env.example](.env.example). Obrigatórias: `DATABASE_URL`, `SESSION_SECRET` (≥ 32 caracteres). Opcionais: `TEST_DATABASE_URL`, `APP_TIMEZONE` (padrão `America/Sao_Paulo`), `SESSION_TTL_HOURS` (12), `COOKIE_SECURE` (padrão `true` em produção), `ATTACHMENTS_DIR`, `BACKUP_DIR`.

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — estrutura de pastas, camadas, decisões, segurança e pesquisa global.
- [docs/BANCO.md](docs/BANCO.md) — modelo de dados, relacionamentos, migrações e regras fora do schema.
- [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) — instalação em Linux, systemd, nginx, rede local/VPN, backups, restauração e atualização.
- [docs/TESTES.md](docs/TESTES.md) — o que é testado e como executar.

## Premissas adotadas

- Uso inicial por um único supervisor (perfil `SUPERVISOR`); existe o perfil `ASSISTANT` (auxiliar, sem acesso a frequência, feedbacks, anotações e auditoria) para comprovar a autorização por módulo e uso futuro.
- Horários são de parede no fuso `APP_TIMEZONE`; datas são de calendário (sem fuso). Plantões que atravessam a meia-noite pertencem à data de início.
- O controle de frequência é **gerencial**: não calcula descontos salariais nem avalia a validade jurídica de atestados.
- Métricas são lançadas manualmente, uma por colaborador e mês; correções preservam os valores anteriores.
