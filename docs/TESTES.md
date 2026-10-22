# Testes

```bash
npm run db:test:prepare   # migra o banco indicado em TEST_DATABASE_URL (nunca o principal)
npm test                  # Vitest: unidade + integração
npm run lint
npm run typecheck
npm run build
```

Os testes de integração usam PostgreSQL real (o mesmo motor de produção), limpam o banco de testes antes de cada caso e são ignorados automaticamente se `TEST_DATABASE_URL` não estiver definida. Anexos de teste vão para um diretório temporário.

## Cobertura por área

| Arquivo | Cenários |
|---|---|
| `unit/attendance-rules.test.ts` | jornadas padrão (8h com almoço não computável, estagiários 6h), fim de semana, 12x36 alternado (inclusive antes da referência), plantão noturno atravessando a meia-noite, falta de dia inteiro, ausência parcial, atraso, ausência no almoço, sem dupla contagem, ocorrências desconsideradas, falta em folga, histórico de vigência, sobreposição de vigências, trocas/ajustes e revogação |
| `unit/text-ranking.test.ts` | normalização sem acentos, neutralização de curingas, identificadores, destaque, ordem de relevância, meses, alinhamento pós-meia-noite, fuso horário, redação da auditoria |
| `integration/auth.test.ts` | Argon2id, política de senha, proxy de rotas, permissões por perfil, login, mensagem genérica, bloqueio por tentativas, usuário inativo, hash do token, expiração/renovação/invalidação de sessão, troca de senha |
| `integration/employees-metrics.test.ts` | cadastro e auditoria, validação, inativação preservando históricos, vínculo por ID após renomear, permissão de escrita, duplicidade de métricas, avaliação fora de 0–10 (Zod e CHECK), correções com valor original, séries com meses vazios e agregação ponderada |
| `integration/attendance.test.ts` | 12x36 com referência obrigatória, encerramento de vigência, bloqueio de alteração de jornada atribuída, períodos sobrepostos, ausência pós-meia-noite, horário obrigatório e duplicidade, correção com motivo e auditoria sem conteúdo restrito, exclusão lógica, ocultação de dados restritos, anexos (tipo real, permissão, nome seguro), troca de plantão espelhada e revogação |
| `integration/search.test.ts` | nome completo, parte do nome, sem acento, funções/equipes, título de reunião, palavra da pauta, tarefa, identificador (TAR-, COL-), mês de métricas, sem resultados, caracteres especiais/injeção, conteúdo restrito nunca exposto, permissões do perfil auxiliar, filtro de período, limite por categoria, termo curto, módulos vazios |
| `integration/meetings-tasks-reports.test.ts` | pauta ordenável, reutilização de pauta, tarefas vinculadas a reunião e colaborador, atrasadas, exclusão de reunião preservando tarefa, vínculos inválidos, histórico da tarefa, vínculo de feedback oculto, série semanal idempotente, proteção de células Excel, validação de parâmetros, Excel válido com totais e filtros, PDF válido, frequência sem dados restritos, confirmação de feedbacks, permissões |

## Verificações manuais realizadas no navegador

Login; validação de formulário com valores preservados; cadastro de colaborador; atribuição 12x36 (erro sem referência e calendário gerado); ocorrência 03:00–07:00 em plantão noturno exibida como `03:00–07:00 (+1)`; reunião com pauta, reordenação e ação vinculada; pesquisa global com Ctrl+K, resultados agrupados e destacados, ↓ + Enter abrindo o registro, estado sem resultados e Esc fechando; layout em 375px sem rolagem horizontal e menu recolhível; build de produção (`next start`) com todas as páginas renderizando, exportação XLSX/PDF, 401 sem sessão e cabeçalhos de segurança; backup com `pg_dump` e restauração em banco temporário com contagens conferidas.
