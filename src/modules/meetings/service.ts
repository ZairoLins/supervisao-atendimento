import { z } from "zod";
import type { Db, Tx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { MeetingStatus, MeetingType } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { addDays, dayNumber, formatDate, parseTime, weekday } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { buildSearchText, formatCode, normalizeQuery } from "@/lib/text";
import { dateField, intField, optionalDateField, optionalText, optionalTimeField, optionalUuid, PAGE_SIZE, requiredText, timeField } from "@/lib/validation";

const agendaLines = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : v),
  z.array(z.string().max(300, "Cada item da pauta deve ter até 300 caracteres.")).max(50, "Máximo de 50 itens.").default([]),
);

const meetingSchema = z.object({
  title: requiredText("o título", 160),
  type: z.enum(["WEEKLY", "EXTRAORDINARY"], { error: "Selecione o tipo." }),
  date: dateField(),
  startTime: timeField("o horário de início"),
  endTime: optionalTimeField(),
  location: optionalText(160),
  participantIds: z.array(z.string().uuid()).default([]),
  agenda: agendaLines,
  copyFromMeetingId: optionalUuid(),
  templateId: optionalUuid(),
});

function meetingTimes(start: string, end?: string) {
  const startMinute = parseTime(start);
  const endMinute = end ? parseTime(end) : null;
  if (endMinute !== null && endMinute <= startMinute) throw new ValidationError("O término deve ser posterior ao início.", { endTime: "Horário inválido." });
  return { startMinute, endMinute };
}

async function reindexMeeting(tx: Tx, meetingId: string) {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { agendaItems: { select: { title: true } } } });
  await tx.meeting.update({
    where: { id: meetingId },
    data: { searchText: buildSearchText(formatCode("meeting", m.code), m.title, m.location, m.agendaItems.map((a) => a.title).join(" "), m.minutes?.slice(0, 2000)) },
  });
}

async function agendaSource(tx: Tx, v: { agenda: string[]; copyFromMeetingId?: string; templateId?: string }) {
  if (v.agenda.length) return v.agenda.map((title) => ({ title, description: null as string | null }));
  if (v.copyFromMeetingId) {
    const items = await tx.meetingAgendaItem.findMany({ where: { meetingId: v.copyFromMeetingId }, orderBy: { position: "asc" } });
    return items.map((i) => ({ title: i.title, description: i.description }));
  }
  if (v.templateId) {
    const t = await tx.meetingTemplate.findUnique({ where: { id: v.templateId } });
    return (t?.agendaItems ?? []).map((title) => ({ title, description: null }));
  }
  return [];
}

export async function createMeeting(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = meetingSchema.parse(raw);
  const { startMinute, endMinute } = meetingTimes(v.startTime, v.endTime);
  return db.$transaction(async (tx) => {
    const agenda = await agendaSource(tx, v);
    const meeting = await tx.meeting.create({
      data: {
        title: v.title,
        type: v.type,
        date: v.date,
        startMinute,
        endMinute,
        location: v.location ?? null,
        participants: { create: [...new Set(v.participantIds)].map((employeeId) => ({ employeeId })) },
        agendaItems: { create: agenda.map((a, i) => ({ position: i, title: a.title, description: a.description, searchText: buildSearchText(a.title, a.description) })) },
      },
    });
    await reindexMeeting(tx, meeting.id);
    await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "Meeting", entityId: meeting.id, summary: `Reunião ${formatCode("meeting", meeting.code)} criada`, after: meeting });
    return meeting;
  });
}

const meetingUpdateSchema = meetingSchema.omit({ agenda: true, copyFromMeetingId: true, templateId: true }).extend({
  status: z.enum(["SCHEDULED", "DONE", "CANCELED"]),
});

export async function updateMeeting(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = meetingUpdateSchema.parse(raw);
  const { startMinute, endMinute } = meetingTimes(v.startTime, v.endTime);
  return db.$transaction(async (tx) => {
    const before = await tx.meeting.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Reunião não encontrada.");
    await tx.meetingParticipant.deleteMany({ where: { meetingId: id, employeeId: { notIn: v.participantIds } } });
    for (const employeeId of new Set(v.participantIds)) {
      await tx.meetingParticipant.upsert({ where: { meetingId_employeeId: { meetingId: id, employeeId } }, create: { meetingId: id, employeeId }, update: {} });
    }
    const after = await tx.meeting.update({
      where: { id },
      data: { title: v.title, type: v.type, status: v.status, date: v.date, startMinute, endMinute, location: v.location ?? null },
    });
    await reindexMeeting(tx, id);
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "Meeting", entityId: id, summary: `Reunião ${formatCode("meeting", after.code)} atualizada`, before, after });
    return after;
  });
}

/** Ata: anotações realizadas durante a reunião (separadas da pauta planejada). */
export async function saveMinutes(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = z.object({ minutes: optionalText(20_000), markDone: z.preprocess((x) => x === "on", z.boolean()) }).parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.meeting.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Reunião não encontrada.");
    const after = await tx.meeting.update({
      where: { id },
      data: { minutes: v.minutes ?? null, ...(v.markDone ? { status: "DONE" as const } : {}) },
    });
    await reindexMeeting(tx, id);
    await audit(tx, { actorId: actor.id, action: "UPDATE_MINUTES", entityType: "Meeting", entityId: id, summary: `Ata da reunião ${formatCode("meeting", after.code)} registrada`, before, after });
    return after;
  });
}

export async function deleteMeeting(db: Db, actor: Actor, id: string) {
  assertCan(actor, "meetings:write");
  return db.$transaction(async (tx) => {
    const m = await tx.meeting.findUnique({ where: { id } });
    if (!m || m.deletedAt) throw new NotFoundError("Reunião não encontrada.");
    await tx.meeting.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "Meeting", entityId: id, summary: `Reunião ${formatCode("meeting", m.code)} excluída` });
  });
}

// ───────────── Pauta ─────────────

export async function addAgendaItem(db: Db, actor: Actor, meetingId: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = z.object({ title: requiredText("o item da pauta", 300), description: optionalText(2000) }).parse(raw);
  return db.$transaction(async (tx) => {
    const m = await tx.meeting.findUnique({ where: { id: meetingId } });
    if (!m || m.deletedAt) throw new NotFoundError("Reunião não encontrada.");
    const last = await tx.meetingAgendaItem.findFirst({ where: { meetingId }, orderBy: { position: "desc" } });
    const item = await tx.meetingAgendaItem.create({
      data: { meetingId, position: (last?.position ?? -1) + 1, title: v.title, description: v.description ?? null, searchText: buildSearchText(v.title, v.description) },
    });
    await reindexMeeting(tx, meetingId);
    return item;
  });
}

export async function updateAgendaItem(db: Db, actor: Actor, itemId: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = z.object({ title: requiredText("o item da pauta", 300), description: optionalText(2000), discussed: z.preprocess((x) => x === "on", z.boolean()) }).parse(raw);
  return db.$transaction(async (tx) => {
    const item = await tx.meetingAgendaItem.update({
      where: { id: itemId },
      data: { title: v.title, description: v.description ?? null, discussed: v.discussed, searchText: buildSearchText(v.title, v.description) },
    });
    await reindexMeeting(tx, item.meetingId);
    return item;
  });
}

export async function toggleAgendaDiscussed(db: Db, actor: Actor, itemId: string) {
  assertCan(actor, "meetings:write");
  const item = await db.meetingAgendaItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("Item não encontrado.");
  return db.meetingAgendaItem.update({ where: { id: itemId }, data: { discussed: !item.discussed } });
}

/** Reordena a pauta trocando a posição com o item vizinho. */
export async function moveAgendaItem(db: Db, actor: Actor, itemId: string, direction: "up" | "down") {
  assertCan(actor, "meetings:write");
  return db.$transaction(async (tx) => {
    const item = await tx.meetingAgendaItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError("Item não encontrado.");
    const items = await tx.meetingAgendaItem.findMany({ where: { meetingId: item.meetingId }, orderBy: { position: "asc" } });
    const idx = items.findIndex((i) => i.id === itemId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const reordered = [...items];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // Renumeração em duas etapas evita conflito temporário de posições
    for (let i = 0; i < reordered.length; i++) await tx.meetingAgendaItem.update({ where: { id: reordered[i].id }, data: { position: 1000 + i } });
    for (let i = 0; i < reordered.length; i++) await tx.meetingAgendaItem.update({ where: { id: reordered[i].id }, data: { position: i } });
  });
}

export async function removeAgendaItem(db: Db, actor: Actor, itemId: string) {
  assertCan(actor, "meetings:write");
  return db.$transaction(async (tx) => {
    const item = await tx.meetingAgendaItem.delete({ where: { id: itemId } });
    const rest = await tx.meetingAgendaItem.findMany({ where: { meetingId: item.meetingId }, orderBy: { position: "asc" } });
    for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await tx.meetingAgendaItem.update({ where: { id: rest[i].id }, data: { position: i } });
    await reindexMeeting(tx, item.meetingId);
  });
}

// ───────────── Decisões e encaminhamentos ─────────────

export async function addDecision(db: Db, actor: Actor, meetingId: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = z.object({ description: requiredText("a decisão", 1000) }).parse(raw);
  return db.$transaction(async (tx) => {
    const m = await tx.meeting.findUnique({ where: { id: meetingId } });
    if (!m || m.deletedAt) throw new NotFoundError("Reunião não encontrada.");
    const last = await tx.meetingDecision.findFirst({ where: { meetingId }, orderBy: { position: "desc" } });
    const d = await tx.meetingDecision.create({ data: { meetingId, position: (last?.position ?? -1) + 1, description: v.description } });
    await audit(tx, { actorId: actor.id, action: "ADD_DECISION", entityType: "Meeting", entityId: meetingId, summary: `Decisão registrada na reunião ${formatCode("meeting", m.code)}` });
    return d;
  });
}

export async function removeDecision(db: Db, actor: Actor, decisionId: string) {
  assertCan(actor, "meetings:write");
  await db.meetingDecision.delete({ where: { id: decisionId } });
}

export async function setAttendance(db: Db, actor: Actor, meetingId: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = z.object({ attended: z.array(z.string().uuid()).default([]) }).parse(raw);
  const participants = await db.meetingParticipant.findMany({ where: { meetingId } });
  await db.$transaction(
    participants.map((p) =>
      db.meetingParticipant.update({
        where: { meetingId_employeeId: { meetingId, employeeId: p.employeeId } },
        data: { attended: v.attended.includes(p.employeeId) },
      }),
    ),
  );
}

// ───────────── Consultas ─────────────

export async function getMeeting(db: Db, actor: Actor, id: string) {
  assertCan(actor, "meetings:read");
  const m = await db.meeting.findUnique({
    where: { id },
    include: {
      agendaItems: { orderBy: { position: "asc" } },
      decisions: { orderBy: { position: "asc" } },
      participants: { include: { employee: { select: { id: true, fullName: true, code: true, status: true } } }, orderBy: { employee: { fullName: "asc" } } },
      tasks: {
        where: { deletedAt: null },
        include: { assigneeEmployee: { select: { fullName: true } }, assigneeUser: { select: { name: true } } },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      },
      series: true,
    },
  });
  if (!m || m.deletedAt) throw new NotFoundError("Reunião não encontrada.");
  return m;
}

export type MeetingFilters = { q?: string; type?: MeetingType; status?: MeetingStatus; from?: Date; to?: Date; when?: "upcoming" | "past"; page?: number; employeeId?: string };

export async function listMeetings(db: Db, actor: Actor, f: MeetingFilters, today: Date) {
  assertCan(actor, "meetings:read");
  const where: Prisma.MeetingWhereInput = { deletedAt: null };
  if (f.type) where.type = f.type;
  if (f.status) where.status = f.status;
  if (f.employeeId) where.participants = { some: { employeeId: f.employeeId } };
  const dateFilter: Prisma.DateTimeFilter = {};
  if (f.from) dateFilter.gte = f.from;
  if (f.to) dateFilter.lte = f.to;
  if (f.when === "upcoming") dateFilter.gte = f.from && f.from > today ? f.from : today;
  if (f.when === "past") dateFilter.lt = today;
  if (Object.keys(dateFilter).length) where.date = dateFilter;
  const q = normalizeQuery(f.q);
  if (q) where.OR = [{ searchText: { contains: q } }, { agendaItems: { some: { searchText: { contains: q } } } }];
  const page = f.page ?? 1;
  const asc = f.when === "upcoming";
  const [total, items] = await Promise.all([
    db.meeting.count({ where }),
    db.meeting.findMany({
      where,
      include: { _count: { select: { agendaItems: true, participants: true, tasks: { where: { deletedAt: null } } } } },
      orderBy: [{ date: asc ? "asc" : "desc" }, { startMinute: asc ? "asc" : "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

export async function meetingOptions(db: Db, actor: Actor) {
  assertCan(actor, "meetings:read");
  const rows = await db.meeting.findMany({ where: { deletedAt: null }, orderBy: { date: "desc" }, take: 200, select: { id: true, title: true, date: true, code: true } });
  return rows.map((m) => ({ value: m.id, label: `${formatDate(m.date)} · ${m.title}` }));
}

// ───────────── Modelos e séries ─────────────

const templateSchema = z.object({
  name: requiredText("o nome do modelo", 120),
  type: z.enum(["WEEKLY", "EXTRAORDINARY"]),
  durationMinutes: intField("a duração", 5, 600),
  agenda: agendaLines,
});

export async function createTemplate(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = templateSchema.parse(raw);
  const exists = await db.meetingTemplate.findUnique({ where: { name: v.name } });
  if (exists) throw new ValidationError("Já existe um modelo com este nome.", { name: "Nome já utilizado." });
  return db.meetingTemplate.create({ data: { name: v.name, type: v.type, durationMinutes: v.durationMinutes, agendaItems: v.agenda } });
}

/** Salva a pauta de uma reunião como modelo reutilizável. */
export async function templateFromMeeting(db: Db, actor: Actor, meetingId: string, raw: unknown) {
  assertCan(actor, "meetings:write");
  const { name } = z.object({ name: requiredText("o nome do modelo", 120) }).parse(raw);
  const m = await getMeeting(db, actor, meetingId);
  const exists = await db.meetingTemplate.findUnique({ where: { name } });
  if (exists) throw new ValidationError("Já existe um modelo com este nome.", { name: "Nome já utilizado." });
  return db.meetingTemplate.create({
    data: { name, type: m.type, durationMinutes: m.endMinute ? m.endMinute - m.startMinute : 60, agendaItems: m.agendaItems.map((a) => a.title) },
  });
}

export async function deleteTemplate(db: Db, actor: Actor, id: string) {
  assertCan(actor, "meetings:write");
  await db.meetingTemplate.delete({ where: { id } });
}

export async function listTemplates(db: Db, actor: Actor) {
  assertCan(actor, "meetings:read");
  return db.meetingTemplate.findMany({ orderBy: { name: "asc" } });
}

const seriesSchema = z.object({
  title: requiredText("o título", 160),
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: timeField(),
  endTime: timeField("o horário de término"),
  startDate: dateField("a data inicial"),
  endDate: optionalDateField(),
  templateId: optionalUuid(),
  weeksAhead: intField("as semanas a gerar", 1, 26),
  participantIds: z.array(z.string().uuid()).default([]),
});

/** Cria série semanal recorrente e gera as próximas instâncias (cada uma independente). */
export async function createSeries(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "meetings:write");
  const v = seriesSchema.parse(raw);
  const { startMinute, endMinute } = meetingTimes(v.startTime, v.endTime);
  if (v.endDate && dayNumber(v.endDate) < dayNumber(v.startDate)) throw new ValidationError("A data final deve ser posterior à inicial.", { endDate: "Data inválida." });
  const series = await db.meetingSeries.create({
    data: { title: v.title, weekday: v.weekday, startMinute, endMinute: endMinute!, startDate: v.startDate, endDate: v.endDate ?? null, templateId: v.templateId ?? null },
  });
  const created = await generateSeriesMeetings(db, actor, series.id, v.weeksAhead, v.participantIds);
  await audit(db, { actorId: actor.id, action: "CREATE", entityType: "MeetingSeries", entityId: series.id, summary: `Série semanal "${series.title}" criada com ${created} reuniões` });
  return series;
}

/** Gera instâncias futuras da série; datas já existentes são ignoradas (idempotente). */
export async function generateSeriesMeetings(db: Db, actor: Actor, seriesId: string, weeks: number, participantIds?: string[]) {
  assertCan(actor, "meetings:write");
  const series = await db.meetingSeries.findUnique({ where: { id: seriesId }, include: { template: true, meetings: { orderBy: { date: "desc" }, take: 1, include: { participants: true } } } });
  if (!series || !series.active) throw new NotFoundError("Série não encontrada ou inativa.");
  const lastMeeting = series.meetings[0];
  let cursor = lastMeeting ? addDays(lastMeeting.date, 1) : series.startDate;
  while (weekday(cursor) !== series.weekday) cursor = addDays(cursor, 1);
  const participants = participantIds ?? lastMeeting?.participants.map((p) => p.employeeId) ?? [];
  let created = 0;
  for (let i = 0; i < weeks; i++) {
    const date = addDays(cursor, i * 7);
    if (series.endDate && dayNumber(date) > dayNumber(series.endDate)) break;
    await db.$transaction(async (tx) => {
      const exists = await tx.meeting.findUnique({ where: { seriesId_date: { seriesId, date } } });
      if (exists) return;
      const m = await tx.meeting.create({
        data: {
          title: series.title,
          type: "WEEKLY",
          date,
          startMinute: series.startMinute,
          endMinute: series.endMinute,
          seriesId,
          participants: { create: participants.map((employeeId) => ({ employeeId })) },
          agendaItems: { create: (series.template?.agendaItems ?? []).map((title, idx) => ({ position: idx, title, searchText: buildSearchText(title) })) },
        },
      });
      await reindexMeeting(tx, m.id);
      created++;
    });
  }
  return created;
}

export async function listSeries(db: Db, actor: Actor) {
  assertCan(actor, "meetings:read");
  return db.meetingSeries.findMany({
    include: { template: { select: { name: true } }, _count: { select: { meetings: { where: { deletedAt: null } } } } },
    orderBy: { title: "asc" },
  });
}

export async function toggleSeries(db: Db, actor: Actor, id: string) {
  assertCan(actor, "meetings:write");
  const s = await db.meetingSeries.findUnique({ where: { id } });
  if (!s) throw new NotFoundError();
  return db.meetingSeries.update({ where: { id }, data: { active: !s.active } });
}
