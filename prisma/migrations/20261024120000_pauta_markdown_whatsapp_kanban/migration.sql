-- v4: pauta em Markdown, quantidade de avaliações, envio pelo WhatsApp e Kanban da semana.

-- CreateEnum
CREATE TYPE "KanbanColumn" AS ENUM ('TODO', 'DOING', 'DONE');
CREATE TYPE "KanbanPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE "MessageTarget" AS ENUM ('MANAGER', 'GROUP');
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

-- ── Pauta em Markdown ──
ALTER TABLE "Meeting" ADD COLUMN "agenda" TEXT NOT NULL DEFAULT '',
ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Itens existentes viram lista de tarefas: "- [x]" quando já discutidos.
-- Descrições entram como linha recuada abaixo do item.
UPDATE "Meeting" m
SET "agenda" = sub.md
FROM (
  SELECT "meetingId",
         string_agg(
           '- [' || CASE WHEN "discussed" THEN 'x' ELSE ' ' END || '] ' || "title"
             || COALESCE(E'\n  ' || NULLIF(btrim("description"), ''), ''),
           E'\n' ORDER BY "position"
         ) AS md
  FROM "MeetingAgendaItem"
  GROUP BY "meetingId"
) sub
WHERE m."id" = sub."meetingId";

-- Já marca como enviados os avisos de reuniões passadas (o aviso automático só vale daqui em diante)
UPDATE "Meeting" SET "reminderSentAt" = CURRENT_TIMESTAMP WHERE "date" < CURRENT_DATE;

ALTER TABLE "MeetingTemplate" ADD COLUMN "agenda" TEXT NOT NULL DEFAULT '';
UPDATE "MeetingTemplate"
SET "agenda" = COALESCE((SELECT string_agg('- [ ] ' || item, E'\n' ORDER BY ord) FROM unnest("agendaItems") WITH ORDINALITY AS t(item, ord)), '');
ALTER TABLE "MeetingTemplate" DROP COLUMN "agendaItems";

ALTER TABLE "MeetingAgendaItem" DROP CONSTRAINT "MeetingAgendaItem_meetingId_fkey";
DROP TABLE "MeetingAgendaItem";

-- ── Quantidade de avaliações ──
ALTER TABLE "WeeklyMetric" ADD COLUMN "ratingCount" INTEGER;
ALTER TABLE "WeeklyMetricRevision" ADD COLUMN "ratingCount" INTEGER;
ALTER TABLE "WeeklyMetric" ADD CONSTRAINT "WeeklyMetric_ratingCount_check" CHECK ("ratingCount" IS NULL OR "ratingCount" >= 0);

-- ── Kanban da semana ──
CREATE TABLE "KanbanCard" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "column" "KanbanColumn" NOT NULL DEFAULT 'TODO',
    "priority" "KanbanPriority" NOT NULL DEFAULT 'NORMAL',
    "position" INTEGER NOT NULL,
    "weekStart" DATE NOT NULL,
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KanbanCard_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KanbanCard_weekStart_check" CHECK (EXTRACT(ISODOW FROM "weekStart") = 1)
);
CREATE INDEX "KanbanCard_weekStart_column_position_idx" ON "KanbanCard"("weekStart", "column", "position");

-- ── WhatsApp ──
CREATE TABLE "NotificationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "managerName" TEXT,
    "managerPhone" TEXT,
    "groupName" TEXT,
    "groupJid" TEXT,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 2,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationSettings_singleton" CHECK ("id" = 1),
    CONSTRAINT "NotificationSettings_hours_check" CHECK ("reminderHoursBefore" BETWEEN 0 AND 72)
);

CREATE TABLE "OutboundMessage" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target" "MessageTarget" NOT NULL,
    "destination" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "entityId" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");
CREATE INDEX "OutboundMessage_kind_entityId_idx" ON "OutboundMessage"("kind", "entityId");
