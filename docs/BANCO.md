# Banco de dados

PostgreSQL com Prisma 7 (`prisma/schema.prisma`). IDs são UUID v7 (estáveis e ordenáveis). Entidades principais também possuem `code` sequencial legível (COL-0001, REU-0001, TAR-0001, OCO-0001, FDB-0001), usado na pesquisa e nos relatórios. Todos os históricos referenciam colaboradores por ID — renomear um colaborador não quebra vínculos.

## Migrações

| Migração | Conteúdo |
|---|---|
| `20261022194931_init` | todas as tabelas, enums, FKs, índices, extensão `pg_trgm`, índices GIN trigram e restrições CHECK |
| `20261022210000_occurrence_after_midnight` | permite ocorrências na parte do plantão após a meia-noite (início até 47:59 relativo à data do turno) |

Em produção use sempre `npm run db:migrate` (`prisma migrate deploy`), que só aplica migrações versionadas. `CREATE EXTENSION pg_trgm` exige que o usuário do banco seja dono do banco (pg_trgm é extensão confiável no PostgreSQL 13+).

## Entidades e relacionamentos

| Entidade | Responsabilidade | Relacionamentos |
|---|---|---|
| `User` | usuários do sistema (perfil `SUPERVISOR`/`ASSISTANT`) | sessões, auditoria, tarefas atribuídas |
| `Session` | sessões ativas (id = SHA-256 do token) | `User` (cascade) |
| `LoginAttempt` | tentativas para limite de força bruta | — |
| `AuditLog` | trilha de auditoria (diferenças já sem campos sensíveis) | `User` (set null) |
| `Employee` | colaborador; situação ACTIVE/ON_LEAVE/INACTIVE | todas as entidades de histórico (FK `Restrict`) |
| `WorkSchedule` + `WorkScheduleSegment` | modelo de jornada: semanal (dias) ou revezamento (ciclo); períodos computáveis | atribuições |
| `EmployeeScheduleAssignment` | histórico de vigência jornada↔colaborador; `cycleReferenceDate` para 12x36 | `Employee`, `WorkSchedule` |
| `ShiftAdjustment` | trocas/ajustes sobre a escala prevista (folga ou horário específico); revogáveis | `Employee` (+ colega da troca), ocorrências |
| `OccurrenceType` | tipos de ocorrência (sistema + configuráveis); flags de desconto, horário obrigatório e médico | ocorrências |
| `AttendanceOccurrence` | falta, atestado, atraso etc.; observação administrativa e observação **restrita** | `Employee`, `OccurrenceType`, `ShiftAdjustment`, anexos |
| `Attachment` | metadados de anexos privados (arquivo em `ATTACHMENTS_DIR`) | ocorrência |
| `MonthlyMetric` | métricas mensais; snapshot de função/equipe no mês | `Employee`, revisões |
| `MonthlyMetricRevision` | valores anteriores a cada correção, com motivo | métrica (cascade) |
| `Meeting` | reunião (semanal/extraordinária), ata (`minutes`) | pauta, decisões, participantes, tarefas, série |
| `MeetingAgendaItem` | pauta planejada, ordenável (`position`) | reunião (cascade) |
| `MeetingDecision` | decisões e encaminhamentos | reunião (cascade) |
| `MeetingParticipant` | participantes e presença | reunião, colaborador |
| `MeetingTemplate` / `MeetingSeries` | modelos de pauta / recorrência semanal que gera reuniões independentes | — |
| `Feedback` | feedback individual (contexto, pontos, ações, acompanhamento) | `Employee`, tarefas |
| `EmployeeNote` | anotações profissionais (separadas de feedback e frequência) | `Employee` |
| `Task` + `TaskEvent` | tarefas com responsável (usuário ou colaborador), vínculos opcionais e histórico campo a campo | colaborador, reunião, feedback |

O **calendário de turnos (ShiftCalendar)** não é materializado: é derivado de forma determinística de `EmployeeScheduleAssignment` + regra da jornada, com `ShiftAdjustment` sobreposto. Assim, a escala prevista original nunca é apagada e o histórico é reconstruível para qualquer data.

## Restrições no banco

- Unicidade: `Employee.code`, `MonthlyMetric(employeeId, month)`, `Meeting(seriesId, date)`, `OccurrenceType.code/name`, `WorkSchedule.name`, `MeetingTemplate.name`, `User.username`, `Attachment.storedName`.
- CHECK: avaliação entre 0 e 10, chamados e TMA não negativos, mês no dia 1; faixas de minutos de jornadas, ocorrências, ajustes e reuniões; `validTo >= validFrom`.
- Índices: filtros por colaborador/data, status, prazo; GIN `pg_trgm` em todos os `searchText`.

## Regras garantidas pela aplicação (não expressáveis no schema)

1. **Sem sobreposição de vigências** de jornada por colaborador (validação em transação `Serializable`); nova atribuição encerra a aberta no dia anterior e não pode iniciar antes de uma existente.
2. **Jornada já atribuída não muda horários/regra** — só nome, descrição e situação (preserva cálculos históricos).
3. Jornada de revezamento exige `cycleReferenceDate` na atribuição.
4. **Ocorrência duplicada** (mesmo colaborador, tipo, data e horário, não excluída) é rejeitada; tipos que exigem horário rejeitam ocorrência sem horário.
5. Correção de ocorrência e de métrica **exige motivo**; a ocorrência guarda antes/depois na auditoria e a métrica guarda o original em `MonthlyMetricRevision`.
6. **Cálculo de horas:** previsto = trechos efetivos dos turnos iniciados no período; ausência = união das ocorrências que descontam (dia inteiro = turno efetivo; parcial = intervalo informado) intersectada com os trechos previstos; cada minuto conta uma vez; ocorrências "desconsideradas" não contam; horários antes do início de um plantão noturno pertencem à parte após a meia-noite.
7. `searchText` é recalculado em toda escrita pelo serviço do módulo e nunca contém dados restritos.
8. `restrictedNotes` só é lido/gravado com a permissão `attendance:restricted`; a auditoria registra apenas "[restrito]".
9. Inativação de colaborador não remove históricos; colaborador inativo não pode ser editado até ser reativado.
10. Exclusões de ocorrências, reuniões, feedbacks, anotações e tarefas são lógicas (`deletedAt`).
