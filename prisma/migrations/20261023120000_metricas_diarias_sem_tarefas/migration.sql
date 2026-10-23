-- ─── 1. Ocorrências: modo de informar o horário ───────────────────────────────
-- ARRIVAL (atraso): informa só a hora de chegada; DEPARTURE (saída antecipada): só a
-- hora de saída. O período é completado com a jornada prevista do colaborador.
CREATE TYPE "OccurrenceTimeMode" AS ENUM ('NONE', 'ARRIVAL', 'DEPARTURE', 'RANGE');

ALTER TABLE "OccurrenceType" ADD COLUMN "timeMode" "OccurrenceTimeMode" NOT NULL DEFAULT 'NONE';
UPDATE "OccurrenceType" SET "timeMode" = 'RANGE' WHERE "requiresTimeRange" = true;
UPDATE "OccurrenceType" SET "timeMode" = 'ARRIVAL' WHERE "code" = 'ATRASO';
UPDATE "OccurrenceType" SET "timeMode" = 'DEPARTURE' WHERE "code" = 'SAIDA_ANTECIPADA';
ALTER TABLE "OccurrenceType" DROP COLUMN "requiresTimeRange";

-- ─── 2. Métricas mensais → diárias (dados existentes preservados) ─────────────
-- Lançamentos mensais antigos passam a valer para o 1º dia do respectivo mês.
ALTER TABLE "MonthlyMetric" DROP CONSTRAINT "MonthlyMetric_month_first_day";
ALTER TABLE "MonthlyMetric" RENAME TO "DailyMetric";
ALTER TABLE "DailyMetric" RENAME COLUMN "month" TO "date";
ALTER TABLE "DailyMetric" RENAME CONSTRAINT "MonthlyMetric_pkey" TO "DailyMetric_pkey";
ALTER TABLE "DailyMetric" RENAME CONSTRAINT "MonthlyMetric_employeeId_fkey" TO "DailyMetric_employeeId_fkey";
ALTER TABLE "DailyMetric" RENAME CONSTRAINT "MonthlyMetric_rating_range" TO "DailyMetric_rating_range";
ALTER TABLE "DailyMetric" RENAME CONSTRAINT "MonthlyMetric_tickets_nonneg" TO "DailyMetric_tickets_nonneg";
ALTER TABLE "DailyMetric" RENAME CONSTRAINT "MonthlyMetric_aht_nonneg" TO "DailyMetric_aht_nonneg";
ALTER INDEX "MonthlyMetric_employeeId_month_key" RENAME TO "DailyMetric_employeeId_date_key";
ALTER INDEX "MonthlyMetric_month_idx" RENAME TO "DailyMetric_date_idx";

ALTER TABLE "MonthlyMetricRevision" RENAME TO "DailyMetricRevision";
ALTER TABLE "DailyMetricRevision" RENAME CONSTRAINT "MonthlyMetricRevision_pkey" TO "DailyMetricRevision_pkey";
ALTER TABLE "DailyMetricRevision" RENAME CONSTRAINT "MonthlyMetricRevision_metricId_fkey" TO "DailyMetricRevision_metricId_fkey";
ALTER TABLE "DailyMetricRevision" RENAME CONSTRAINT "MonthlyMetricRevision_rating_range" TO "DailyMetricRevision_rating_range";
ALTER INDEX "MonthlyMetricRevision_metricId_createdAt_idx" RENAME TO "DailyMetricRevision_metricId_createdAt_idx";

-- ─── 3. Remoção do módulo de tarefas ──────────────────────────────────────────
DROP TABLE "TaskEvent";
DROP TABLE "Task";
DROP TYPE "TaskPriority";
DROP TYPE "TaskStatus";
