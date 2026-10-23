# Banco de dados

PostgreSQL com Prisma 7 (`prisma/schema.prisma`). IDs são UUID v7 (estáveis e ordenáveis). Entidades principais também possuem `code` sequencial legível (COL-0001, REU-0001, TAR-0001, OCO-0001, FDB-0001), usado na pesquisa e nos relatórios. Todos os históricos referenciam colaboradores por ID — renomear um colaborador não quebra vínculos.

## Migrações

| Migração | Conteúdo |
|---|---|
| `20261022194931_init` | todas as tabelas, enums, FKs, índices, extensão `pg_trgm`, índices GIN trigram e restrições CHECK |
| `20261022210000_occurrence_after_midnight` | permite ocorrências na parte do plantão após a meia-noite (início até 47:59 relativo à data do turno) |
| `20261023180000_metricas_semanais_sabado` | métricas passam a ser semanais (`WeeklyMetric`, lançamentos diários consolidados por semana), horário específico por dia da semana nas jornadas e sábado 08:00–12:00 na jornada padrão de Funcionário |
| `20261023120000_metricas_diarias_sem_tarefas` | métricas passam a ser diárias (tabela renomeada, dados preservados no 1º dia do mês), modo de horário dos tipos de ocorrência (chegada/saída/período) e remoção das tabelas de tarefas |

Em produção use sempre `npm run db:migrate` (`prisma migrate deploy`), que só aplica migrações versionadas. `CREATE EXTENSION pg_trgm` exige que o usuário do banco seja dono do banco (pg_trgm é extensão confiável no PostgreSQL 13+).

## Entidades e relacionamentos

| Entidade | Responsabilidade | Relacionamentos |
|---|---|---|
| `User` | usuários do sistema (perfil `SUPERVISOR`/`ASSISTANT`) | sessões, auditoria |
| `Session` | sessões ativas (id = SHA-256 do token) | `User` (cascade) |
| `LoginAttempt` | tentativas para limite de força bruta | — |
| `AuditLog` | trilha de auditoria (diferenças já sem campos sensíveis) | `User` (set null) |
| `Employee` | colaborador; situação ACTIVE/ON_LEAVE/INACTIVE | todas as entidades de histórico (FK `Restrict`) |
| `WorkSchedule` + `WorkScheduleSegment` | modelo de jornada: semanal (dias) ou revezamento (ciclo); períodos computáveis, com `weekday` opcional para horário próprio de um dia | atribuições |
| `EmployeeScheduleAssignment` | histórico de vigência jornada↔colaborador; `cycleReferenceDate` para 12x36 | `Employee`, `WorkSchedule` |
| `ShiftAdjustment` | trocas/ajustes sobre a escala prevista (folga ou horário específico); revogáveis | `Employee` (+ colega da troca), ocorrências |
| `OccurrenceType` | tipos de ocorrência (sistema + configuráveis); desconto de horas, médico e `timeMode` (turno inteiro, chegada, saída ou período) | ocorrências |
| `AttendanceOccurrence` | falta, atestado, atraso etc.; observação administrativa e observação **restrita** | `Employee`, `OccurrenceType`, `ShiftAdjustment`, anexos |
| `Attachment` | metadados de anexos privados (arquivo em `ATTACHMENTS_DIR`) | ocorrência |
| `WeeklyMetric` | métricas de uma semana (`weekStart` = segunda-feira); snapshot de função/equipe | `Employee`, revisões |
| `WeeklyMetricRevision` | valores anteriores a cada correção ou ajuste, com motivo | métrica (cascade) |
| `Meeting` | reunião (semanal/extraordinária), ata (`minutes`) | pauta, decisões, participantes, série |
| `MeetingAgendaItem` | pauta planejada, ordenável (`position`) | reunião (cascade) |
| `MeetingDecision` | decisões e encaminhamentos | reunião (cascade) |
| `MeetingParticipant` | participantes e presença | reunião, colaborador |
| `MeetingTemplate` / `MeetingSeries` | modelos de pauta / recorrência semanal que gera reuniões independentes | — |
| `Feedback` | feedback individual (contexto, pontos, ações, acompanhamento) | `Employee` |
| `EmployeeNote` | anotações profissionais (separadas de feedback e frequência) | `Employee` |

O **calendário de turnos (ShiftCalendar)** não é materializado: é derivado de forma determinística de `EmployeeScheduleAssignment` + regra da jornada, com `ShiftAdjustment` sobreposto. Assim, a escala prevista original nunca é apagada e o histórico é reconstruível para qualquer data.

## Restrições no banco

- Unicidade: `Employee.code`, `WeeklyMetric(employeeId, weekStart)`, `Meeting(seriesId, date)`, `OccurrenceType.code/name`, `WorkSchedule.name`, `MeetingTemplate.name`, `User.username`, `Attachment.storedName`.
- CHECK: avaliação entre 0 e 10, chamados e TMA não negativos, mês no dia 1; faixas de minutos de jornadas, ocorrências, ajustes e reuniões; `validTo >= validFrom`.
- Índices: filtros por colaborador/data, status, prazo; GIN `pg_trgm` em todos os `searchText`.

## Regras garantidas pela aplicação (não expressáveis no schema)

1. **Sem sobreposição de vigências** de jornada por colaborador (validação em transação `Serializable`); nova atribuição encerra a aberta no dia anterior e não pode iniciar antes de uma existente.
2. **Jornada já atribuída não muda horários/regra** — só nome, descrição e situação (preserva cálculos históricos).
3. Jornada de revezamento exige `cycleReferenceDate` na atribuição.
4. **Ocorrência duplicada** (mesmo colaborador, tipo, data e horário, não excluída) é rejeitada; tipos que exigem horário rejeitam ocorrência sem horário.
5. Correção de ocorrência e de métrica **exige motivo**; a ocorrência guarda antes/depois na auditoria e a métrica guarda o original em `WeeklyMetricRevision` (inclusive ajustes feitos pelo lançamento em lote).
11. **Atraso** (`ARRIVAL`): período = início do turno efetivo até a chegada informada; **saída antecipada** (`DEPARTURE`): saída informada até o fim do turno. Sem turno previsto na data, o registro é recusado com orientação.
6. **Cálculo de horas:** previsto = trechos efetivos dos turnos iniciados no período; ausência = união das ocorrências que descontam (dia inteiro = turno efetivo; parcial = intervalo informado) intersectada com os trechos previstos; cada minuto conta uma vez; ocorrências "desconsideradas" não contam; horários antes do início de um plantão noturno pertencem à parte após a meia-noite.
7. `searchText` é recalculado em toda escrita pelo serviço do módulo e nunca contém dados restritos.
8. `restrictedNotes` só é lido/gravado com a permissão `attendance:restricted`; a auditoria registra apenas "[restrito]".
9. Inativação de colaborador não remove históricos; colaborador inativo não pode ser editado até ser reativado.
10. Exclusões de ocorrências, reuniões, feedbacks e anotações são lógicas (`deletedAt`).
