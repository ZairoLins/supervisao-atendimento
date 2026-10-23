# Arquitetura

## Estrutura de pastas

```
prisma/
  schema.prisma            modelo de dados (Prisma 7, generator "prisma-client")
  migrations/              migrações SQL versionadas (inclui CHECKs e pg_trgm)
  seed.ts                  carga idempotente de dados de sistema (sem usuários)
prisma.config.ts           configuração do Prisma CLI (URL do banco, seed)
scripts/
  create-user.ts           cria usuário / redefine senha (senha oculta)
  maintenance.ts           limpeza de sessões e tentativas de login
  prepare-test-db.ts       migra o banco de testes
deploy/                    systemd, nginx, backup, restauração
src/
  proxy.ts                 redirecionamento otimista para /login (Next 16 "proxy")
  app/
    login/                 página e Server Actions de login/logout
    (app)/                 área autenticada (layout com menu + pesquisa global)
      page.tsx             dashboard
      colaboradores/ reunioes/ frequencia/ desempenho/
      feedbacks/ relatorios/ configuracoes/ pesquisa/
    api/pesquisa           endpoint JSON da pesquisa global
    api/relatorios         exportação Excel/PDF gerada no servidor
    api/anexos/[id]        download autenticado de anexos privados
    forbidden.tsx / not-found.tsx
  components/
    ui/                    primitivas (Panel, Badge, Tabs, Pagination…) e formulários
    layout/app-shell.tsx   navegação lateral persistente e recolhível
    search/                paleta de pesquisa (Ctrl/⌘+K) e destaque de termos
    charts/                gráficos Recharts (uma métrica por vez, lacunas = sem registro)
    audit-trail.tsx        histórico de auditoria por registro
  lib/
    auth/                  senhas, sessões, login com limite de tentativas, DAL
    action.ts              execução segura de Server Actions (erros, revalidação)
    audit.ts               auditoria com remoção de campos sensíveis
    dates.ts text.ts       utilitários puros (datas de calendário, normalização)
    permissions.ts         perfis → permissões; can/assertCan
    validation.ts          esquemas Zod reutilizáveis
    labels.ts              rótulos pt-BR e tons de status
  modules/<domínio>/
    service.ts / *.ts      regras de negócio + acesso a dados (recebem db e actor)
    actions.ts             Server Actions finas (autenticação → serviço → revalidação)
    rules.ts               (attendance) cálculo puro de escala e horas
tests/
  unit/                    regras puras
  integration/             serviços contra PostgreSQL real
```

## Camadas

1. **Páginas (Server Components)** chamam `requirePermission(...)` e serviços; nunca acessam o banco diretamente sem passar pela verificação de permissão.
2. **Server Actions** (`modules/*/actions.ts`) são finas: `runAction` obtém o usuário da sessão, chama o serviço e trata erros — mensagens internas nunca vazam; apenas o tipo/código do erro é registrado em log.
3. **Serviços** recebem `(db, actor, entrada)`, validam com Zod, verificam `assertCan(actor, permissão)`, executam a operação em transação e gravam auditoria. São testados diretamente.
4. **Regras puras** (`modules/attendance/rules.ts`) não dependem de banco — cálculo de escala, 12x36, intervalos e horas.

A autorização é verificada no servidor em três pontos: página (`requirePermission`), serviço (`assertCan`) e rotas de API (`getCurrentActor` + serviço). O `proxy.ts` é apenas uma otimização de UX.

## Decisões técnicas

- **Cache Components desativado.** A aplicação é interna, autenticada e 100% dinâmica; todas as páginas leem sessão e banco a cada requisição. Isso simplifica o modelo e evita dados obsoletos. (O Next 16 indica que o recurso será padrão na próxima versão major; migrar exigirá envolver leituras em `<Suspense>`.)
- **Sessões opacas no banco** em vez de JWT: revogáveis (logout, troca de senha, "encerrar outras sessões"), validade deslizante de 12h, cookie `httpOnly`, `sameSite=lax`, `secure` em produção, sem expiração no navegador (some ao fechar). O banco guarda só o SHA-256 do token.
- **Senhas:** Argon2id (m=19 MiB, t=2, p=1 — recomendação OWASP); política mínima de 10 caracteres com letras e números.
- **Limite de tentativas:** 5 falhas por usuário ou 20 por IP (HMAC do IP) em 15 minutos, persistido no banco. Mensagem genérica e custo constante para usuário inexistente.
- **CSRF:** Server Actions validam origem; as rotas de API são somente GET de leitura; cookie `sameSite=lax`.
- **Cabeçalhos:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sem `X-Powered-By`.
- **Tempo:** horários em minutos desde 00:00 da data do turno (fim > 1440 = dia seguinte). Elimina ambiguidade de fuso e torna o cálculo determinístico. "Hoje" é calculado no fuso `APP_TIMEZONE`.
- **Fonte auto-hospedada:** o servidor interno pode não ter internet no build.
- **Exclusão lógica** (`deletedAt`) para ocorrências, reuniões, feedbacks e anotações; colaboradores são inativados, nunca excluídos.

## Pesquisa global

- **Interface:** campo na barra superior em todas as páginas; Ctrl/⌘+K abre a paleta; debounce de 250 ms com cancelamento da requisição anterior; resultados agrupados por tipo com título, resumo, data e destaque discreto do termo; ↑/↓ navegam, Enter abre, Esc fecha; estados inicial, carregando, vazio e erro; link para a página completa `/pesquisa` com filtros de categoria e período.
- **Servidor:** `modules/search/service.ts` concentra provedores por módulo. Cada provedor declara a permissão do módulo de origem; provedores sem permissão nem são executados (não há contagem nem sugestão de registros restritos). Falha de um provedor não derruba os demais.
- **Formato uniforme:** `{ type, id, title, summary, date, url, score }`.
- **Índice:** colunas `searchText` normalizadas (minúsculas, sem acentos) mantidas pelos serviços e indexadas com GIN `pg_trgm`, consultadas com `contains` parametrizado pelo Prisma. Curingas `%`/`_` digitados são neutralizados. Sem Elasticsearch.
- **Relevância:** identificador exato (TAR-12, COL-3…) > título exato > início do título > início de palavra > parcial > apenas conteúdo. Registros encontrados pelo nome do colaborador relacionado (feedbacks, ocorrências, métricas) ficam abaixo do próprio colaborador.
- **Dados sensíveis:** observações restritas, anexos e conteúdo detalhado de feedbacks nunca entram em `searchText` nem nos resumos; para tipos médicos (atestado), nem a observação administrativa é indexada.
- **Abertura do resultado:** a página de destino verifica a permissão novamente.

## Relatórios

O **relatório semanal** (`modules/reports/weekly.ts`) tem layout próprio: PDF com cabeçalho preto e faixa azul, cartões de indicadores com variação em relação à semana anterior, gráfico de barras por colaborador, tabela com barra de avaliação e observações; Excel com faixa de título, indicadores, tabela formatada e barras de dados. Fica disponível em Relatórios, em Desempenho e na tela de lançamento da semana.


Gerados no servidor (`/api/relatorios`), com parâmetros validados por Zod, permissão do módulo de origem, cabeçalho, período, data de geração e totais. Células de texto que começam com `= + - @`, tabulação ou retorno recebem apóstrofo (proteção contra *formula injection*). Frequência nunca inclui observações restritas, anexos ou observações de tipos médicos; feedbacks exigem confirmação explícita e o conteúdo detalhado é opcional. Toda exportação é auditada.

## Design system

Tokens em `src/app/globals.css` (`@theme` do Tailwind 4): fundo `canvas` (#f5f7fb), superfícies `surface` (branco), texto `ink` (quase preto), bordas `line`, ação `primary` (azul #2563eb) e navegação `sidebar` (preto). Estados (`ok`, `warn`, `danger`) têm versão suave para fundos e sempre acompanham texto/ícone. Tipografia Inter (auto-hospedada), títulos em peso 600, cartões com raio 14px e sombra leve, botões e campos com raio 8px e foco azul.
