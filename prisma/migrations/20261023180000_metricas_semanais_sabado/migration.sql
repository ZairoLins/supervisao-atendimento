-- ─── 1. Jornadas: horário específico por dia da semana ───────────────────────
ALTER TABLE "WorkScheduleSegment" ADD COLUMN "weekday" INTEGER;
ALTER TABLE "WorkScheduleSegment"
  ADD CONSTRAINT "WorkScheduleSegment_weekday_range" CHECK ("weekday" IS NULL OR ("weekday" >= 0 AND "weekday" <= 6));

-- Jornada padrão de Funcionário passa a incluir sábado 08:00–12:00
DO $$
DECLARE sid UUID;
BEGIN
  SELECT "id" INTO sid FROM "WorkSchedule" WHERE "name" = 'Funcionário — 08:00–12:00 e 14:00–18:00';
  IF sid IS NOT NULL THEN
    UPDATE "WorkSchedule"
       SET "name" = 'Funcionário — Seg a Sex 08:00–12:00 e 14:00–18:00, Sáb 08:00–12:00',
           "description" = 'Segunda a sexta com intervalo de 2h não computável; sábado das 08:00 às 12:00.',
           "weekdays" = ARRAY[1, 2, 3, 4, 5, 6],
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = sid;
    INSERT INTO "WorkScheduleSegment" ("id", "scheduleId", "position", "weekday", "startMinute", "endMinute")
    SELECT gen_random_uuid(), sid, COALESCE(MAX("position"), -1) + 1, 6, 480, 720
      FROM "WorkScheduleSegment" WHERE "scheduleId" = sid
    HAVING NOT EXISTS (SELECT 1 FROM "WorkScheduleSegment" WHERE "scheduleId" = sid AND "weekday" = 6);
  END IF;
END $$;

-- ─── 2. Métricas diárias → semanais (segunda a domingo) ──────────────────────
CREATE TABLE "WeeklyMetric" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "ticketsHandled" INTEGER NOT NULL,
    "avgHandleMinutes" DECIMAL(8,2) NOT NULL,
    "avgRating" DECIMAL(4,2) NOT NULL,
    "notes" TEXT,
    "jobTitleSnapshot" TEXT NOT NULL,
    "teamSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyMetric_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WeeklyMetric_rating_range" CHECK ("avgRating" >= 0 AND "avgRating" <= 10),
    CONSTRAINT "WeeklyMetric_tickets_nonneg" CHECK ("ticketsHandled" >= 0),
    CONSTRAINT "WeeklyMetric_aht_nonneg" CHECK ("avgHandleMinutes" >= 0),
    CONSTRAINT "WeeklyMetric_week_monday" CHECK (EXTRACT(ISODOW FROM "weekStart") = 1)
);

CREATE TABLE "WeeklyMetricRevision" (
    "id" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "ticketsHandled" INTEGER NOT NULL,
    "avgHandleMinutes" DECIMAL(8,2) NOT NULL,
    "avgRating" DECIMAL(4,2) NOT NULL,
    "notes" TEXT,
    "reason" TEXT NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyMetricRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WeeklyMetricRevision_rating_range" CHECK ("avgRating" >= 0 AND "avgRating" <= 10)
);

CREATE INDEX "WeeklyMetric_weekStart_idx" ON "WeeklyMetric"("weekStart");
CREATE UNIQUE INDEX "WeeklyMetric_employeeId_weekStart_key" ON "WeeklyMetric"("employeeId", "weekStart");
CREATE INDEX "WeeklyMetricRevision_metricId_createdAt_idx" ON "WeeklyMetricRevision"("metricId", "createdAt");
ALTER TABLE "WeeklyMetric" ADD CONSTRAINT "WeeklyMetric_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeeklyMetricRevision" ADD CONSTRAINT "WeeklyMetricRevision_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "WeeklyMetric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lançamentos diários existentes são consolidados por semana (chamados somados;
-- tempo médio e avaliação ponderados pelos chamados).
INSERT INTO "WeeklyMetric" ("id", "employeeId", "weekStart", "ticketsHandled", "avgHandleMinutes", "avgRating", "notes", "jobTitleSnapshot", "teamSnapshot", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       "employeeId",
       date_trunc('week', "date")::date,
       SUM("ticketsHandled"),
       ROUND(CASE WHEN SUM("ticketsHandled") > 0 THEN SUM("avgHandleMinutes" * "ticketsHandled") / SUM("ticketsHandled") ELSE AVG("avgHandleMinutes") END, 2),
       ROUND(CASE WHEN SUM("ticketsHandled") > 0 THEN SUM("avgRating" * "ticketsHandled") / SUM("ticketsHandled") ELSE AVG("avgRating") END, 2),
       NULLIF(string_agg("notes", ' | ' ORDER BY "date"), ''),
       MAX("jobTitleSnapshot"),
       MAX("teamSnapshot"),
       MIN("createdAt"),
       CURRENT_TIMESTAMP
  FROM "DailyMetric"
 GROUP BY "employeeId", date_trunc('week', "date");

DROP TABLE "DailyMetricRevision";
DROP TABLE "DailyMetric";
