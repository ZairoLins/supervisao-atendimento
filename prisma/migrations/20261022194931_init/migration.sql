-- Extensão para índices trigram usados na pesquisa global
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERVISOR', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('WEEKLY', 'ROTATION');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('DAY_OFF', 'CUSTOM_HOURS');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISREGARDED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('WEEKLY', 'EXTRAORDINARY');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('RECOGNITION', 'DEVELOPMENT', 'CORRECTIVE', 'ALIGNMENT', 'ONE_ON_ONE');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'FOLLOW_UP', 'CLOSED');

-- CreateEnum
CREATE TYPE "NoteCategory" AS ENUM ('OBSERVATION', 'RECOGNITION', 'ALIGNMENT', 'DEVELOPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SUPERVISOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "workloadLabel" TEXT,
    "generalNotes" TEXT,
    "inactivatedAt" TIMESTAMP(3),
    "inactivationReason" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ScheduleKind" NOT NULL,
    "description" TEXT,
    "weekdays" INTEGER[],
    "cycleDays" INTEGER,
    "workOffsets" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkScheduleSegment" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "WorkScheduleSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeScheduleAssignment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "cycleReferenceDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeScheduleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAdjustment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "swapWithEmployeeId" UUID,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrenceType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countsAsAbsence" BOOLEAN NOT NULL DEFAULT true,
    "requiresTimeRange" BOOLEAN NOT NULL DEFAULT false,
    "isMedical" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccurrenceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceOccurrence" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "employeeId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "adminNotes" TEXT,
    "restrictedNotes" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "adjustmentId" UUID,
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyMetric" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "ticketsHandled" INTEGER NOT NULL,
    "avgHandleMinutes" DECIMAL(8,2) NOT NULL,
    "avgRating" DECIMAL(4,2) NOT NULL,
    "notes" TEXT,
    "jobTitleSnapshot" TEXT NOT NULL,
    "teamSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyMetricRevision" (
    "id" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "ticketsHandled" INTEGER NOT NULL,
    "avgHandleMinutes" DECIMAL(8,2) NOT NULL,
    "avgRating" DECIMAL(4,2) NOT NULL,
    "notes" TEXT,
    "reason" TEXT NOT NULL,
    "changedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyMetricRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "agendaItems" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSeries" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "templateId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "date" DATE NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER,
    "location" TEXT,
    "minutes" TEXT,
    "seriesId" UUID,
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAgendaItem" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discussed" BOOLEAN NOT NULL DEFAULT false,
    "searchText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecision" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "meetingId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attended" BOOLEAN,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("meetingId","employeeId")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "context" TEXT NOT NULL,
    "positives" TEXT,
    "improvements" TEXT,
    "agreedActions" TEXT,
    "followUpDate" DATE,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "reviewDate" DATE,
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeNote" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" "NoteCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "assigneeUserId" UUID,
    "assigneeEmployeeId" UUID,
    "employeeId" UUID,
    "meetingId" UUID,
    "feedbackId" UUID,
    "searchText" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_username_createdAt_idx" ON "LoginAttempt"("username", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipHash_createdAt_idx" ON "LoginAttempt"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_team_idx" ON "Employee"("team");

-- CreateIndex
CREATE INDEX "Employee_jobTitle_idx" ON "Employee"("jobTitle");

-- CreateIndex
CREATE INDEX "Employee_searchText_idx" ON "Employee" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_name_key" ON "WorkSchedule"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleSegment_scheduleId_position_key" ON "WorkScheduleSegment"("scheduleId", "position");

-- CreateIndex
CREATE INDEX "EmployeeScheduleAssignment_employeeId_validFrom_idx" ON "EmployeeScheduleAssignment"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "ShiftAdjustment_employeeId_date_idx" ON "ShiftAdjustment"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceType_code_key" ON "OccurrenceType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceType_name_key" ON "OccurrenceType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceOccurrence_code_key" ON "AttendanceOccurrence"("code");

-- CreateIndex
CREATE INDEX "AttendanceOccurrence_employeeId_date_idx" ON "AttendanceOccurrence"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceOccurrence_date_idx" ON "AttendanceOccurrence"("date");

-- CreateIndex
CREATE INDEX "AttendanceOccurrence_reviewStatus_idx" ON "AttendanceOccurrence"("reviewStatus");

-- CreateIndex
CREATE INDEX "AttendanceOccurrence_searchText_idx" ON "AttendanceOccurrence" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");

-- CreateIndex
CREATE INDEX "Attachment_occurrenceId_idx" ON "Attachment"("occurrenceId");

-- CreateIndex
CREATE INDEX "MonthlyMetric_month_idx" ON "MonthlyMetric"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyMetric_employeeId_month_key" ON "MonthlyMetric"("employeeId", "month");

-- CreateIndex
CREATE INDEX "MonthlyMetricRevision_metricId_createdAt_idx" ON "MonthlyMetricRevision"("metricId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTemplate_name_key" ON "MeetingTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_code_key" ON "Meeting"("code");

-- CreateIndex
CREATE INDEX "Meeting_date_idx" ON "Meeting"("date");

-- CreateIndex
CREATE INDEX "Meeting_searchText_idx" ON "Meeting" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_seriesId_date_key" ON "Meeting"("seriesId", "date");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_meetingId_position_idx" ON "MeetingAgendaItem"("meetingId", "position");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_searchText_idx" ON "MeetingAgendaItem" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "MeetingDecision_meetingId_position_idx" ON "MeetingDecision"("meetingId", "position");

-- CreateIndex
CREATE INDEX "MeetingParticipant_employeeId_idx" ON "MeetingParticipant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_code_key" ON "Feedback"("code");

-- CreateIndex
CREATE INDEX "Feedback_employeeId_date_idx" ON "Feedback"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE INDEX "Feedback_searchText_idx" ON "Feedback" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "EmployeeNote_employeeId_date_idx" ON "EmployeeNote"("employeeId", "date");

-- CreateIndex
CREATE INDEX "EmployeeNote_searchText_idx" ON "EmployeeNote" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");

-- CreateIndex
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Task_employeeId_idx" ON "Task"("employeeId");

-- CreateIndex
CREATE INDEX "Task_meetingId_idx" ON "Task"("meetingId");

-- CreateIndex
CREATE INDEX "Task_searchText_idx" ON "Task" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleSegment" ADD CONSTRAINT "WorkScheduleSegment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeScheduleAssignment" ADD CONSTRAINT "EmployeeScheduleAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeScheduleAssignment" ADD CONSTRAINT "EmployeeScheduleAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAdjustment" ADD CONSTRAINT "ShiftAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAdjustment" ADD CONSTRAINT "ShiftAdjustment_swapWithEmployeeId_fkey" FOREIGN KEY ("swapWithEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOccurrence" ADD CONSTRAINT "AttendanceOccurrence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOccurrence" ADD CONSTRAINT "AttendanceOccurrence_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "OccurrenceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceOccurrence" ADD CONSTRAINT "AttendanceOccurrence_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "ShiftAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AttendanceOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyMetric" ADD CONSTRAINT "MonthlyMetric_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyMetricRevision" ADD CONSTRAINT "MonthlyMetricRevision_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "MonthlyMetric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MeetingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MeetingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeEmployeeId_fkey" FOREIGN KEY ("assigneeEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Restrições de integridade não expressáveis no schema Prisma ───
ALTER TABLE "MonthlyMetric"
  ADD CONSTRAINT "MonthlyMetric_rating_range" CHECK ("avgRating" >= 0 AND "avgRating" <= 10),
  ADD CONSTRAINT "MonthlyMetric_tickets_nonneg" CHECK ("ticketsHandled" >= 0),
  ADD CONSTRAINT "MonthlyMetric_aht_nonneg" CHECK ("avgHandleMinutes" >= 0),
  ADD CONSTRAINT "MonthlyMetric_month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);

ALTER TABLE "MonthlyMetricRevision"
  ADD CONSTRAINT "MonthlyMetricRevision_rating_range" CHECK ("avgRating" >= 0 AND "avgRating" <= 10);

ALTER TABLE "WorkScheduleSegment"
  ADD CONSTRAINT "WorkScheduleSegment_range" CHECK ("startMinute" >= 0 AND "startMinute" < 1440 AND "endMinute" > "startMinute" AND "endMinute" <= 2880);

ALTER TABLE "AttendanceOccurrence"
  ADD CONSTRAINT "AttendanceOccurrence_range" CHECK (
    ("startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("startMinute" >= 0 AND "startMinute" < 1440 AND "endMinute" > "startMinute" AND "endMinute" <= 2880)
  );

ALTER TABLE "ShiftAdjustment"
  ADD CONSTRAINT "ShiftAdjustment_range" CHECK (
    ("kind" = 'DAY_OFF' AND "startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("kind" = 'CUSTOM_HOURS' AND "startMinute" >= 0 AND "startMinute" < 1440 AND "endMinute" > "startMinute" AND "endMinute" <= 2880)
  );

ALTER TABLE "EmployeeScheduleAssignment"
  ADD CONSTRAINT "EmployeeScheduleAssignment_dates" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE "Meeting"
  ADD CONSTRAINT "Meeting_time_range" CHECK ("startMinute" >= 0 AND "startMinute" < 1440 AND ("endMinute" IS NULL OR "endMinute" > "startMinute"));
