import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ReviewStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { endOfMonth, formatDate, startOfMonth, timeRangeFromInputs, toDateKey } from "@/lib/dates";
import { env } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, can, type Actor } from "@/lib/permissions";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { buildSearchText, formatCode, normalizeQuery } from "@/lib/text";
import { dateField, optionalText, optionalTimeField, PAGE_SIZE, requiredText, uuidField } from "@/lib/validation";
import { loadRules } from "./schedules";
import { planDay, planRange, summarizeAttendance, type AttendanceSummary, type DayPlan } from "./rules";

/**
 * Texto indexável da ocorrência. Para tipos médicos (atestado) nada além do código,
 * tipo e data é indexado — observações e dados restritos nunca entram na pesquisa.
 */
export function occurrenceSearchText(
  o: { code: number; date: Date; adminNotes: string | null },
  type: { name: string; isMedical: boolean },
): string {
  return buildSearchText(formatCode("occurrence", o.code), type.name, formatDate(o.date), type.isMedical ? null : o.adminNotes);
}

/**
 * Horários informados na data de um turno que atravessa a meia-noite: um período que
 * começa antes do início do turno pertence à parte após a meia-noite (ex.: plantão
 * 19:00–07:00 com ausência 03:00–07:00 => 27:00–31:00 relativo à data do turno).
 */
export function alignToShift(range: { startMinute: number; endMinute: number }, plan: Pick<DayPlan, "effective">) {
  const segs = plan.effective.segments;
  if (segs.length === 0) return range;
  const shiftStart = segs[0].startMinute;
  const shiftEnd = segs[segs.length - 1].endMinute;
  if (shiftEnd > 1440 && range.startMinute < shiftStart && range.startMinute + 1440 < shiftEnd) {
    return { startMinute: range.startMinute + 1440, endMinute: range.endMinute + 1440 };
  }
  return range;
}

const occurrenceSchema = z.object({
  employeeId: uuidField("o colaborador"),
  typeId: uuidField("o tipo de ocorrência"),
  date: dateField(),
  startTime: optionalTimeField(),
  endTime: optionalTimeField(),
  adminNotes: optionalText(2000),
  restrictedNotes: optionalText(2000),
  reviewStatus: z.enum(["PENDING", "CONFIRMED", "DISREGARDED"]).default("PENDING"),
});

async function parseOccurrence(db: Db, actor: Actor, raw: unknown) {
  const v = occurrenceSchema.parse(raw);
  const type = await db.occurrenceType.findUnique({ where: { id: v.typeId } });
  if (!type || !type.active) throw new ValidationError("Tipo de ocorrência inválido.", { typeId: "Selecione um tipo ativo." });
  if (type.code === "TROCA_PLANTAO" || type.code === "AJUSTE_ESCALA") {
    throw new ValidationError("Trocas e ajustes são registrados pela escala do colaborador.", { typeId: "Use a tela de escala." });
  }
  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (v.startTime || v.endTime) {
    if (!v.startTime || !v.endTime) throw new ValidationError("Informe horário inicial e final.", { endTime: "Informe os dois horários." });
    const r = alignToShift(timeRangeFromInputs(v.startTime, v.endTime), await planForDate(db, v.employeeId, v.date));
    startMinute = r.startMinute;
    endMinute = r.endMinute;
  } else if (type.requiresTimeRange) {
    throw new ValidationError(`"${type.name}" exige horário inicial e final.`, { startTime: "Obrigatório para este tipo." });
  }
  const restrictedNotes = can(actor, "attendance:restricted") ? (v.restrictedNotes ?? null) : undefined;
  return { v, type, startMinute, endMinute, restrictedNotes };
}

async function assertNoDuplicate(db: Db, data: { employeeId: string; typeId: string; date: Date; startMinute: number | null; endMinute: number | null }, ignoreId?: string) {
  const dup = await db.attendanceOccurrence.findFirst({
    where: { ...data, deletedAt: null, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
    select: { code: true },
  });
  if (dup) throw new ConflictError(`Já existe a ocorrência ${formatCode("occurrence", dup.code)} com os mesmos dados.`, { date: "Registro duplicado." });
}

export async function createOccurrence(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "attendance:write");
  const { v, type, startMinute, endMinute, restrictedNotes } = await parseOccurrence(db, actor, raw);
  const employee = await db.employee.findUnique({ where: { id: v.employeeId } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  const base = { employeeId: v.employeeId, typeId: v.typeId, date: v.date, startMinute, endMinute };
  await assertNoDuplicate(db, base);
  return db.$transaction(async (tx) => {
    const created = await tx.attendanceOccurrence.create({
      data: { ...base, adminNotes: v.adminNotes ?? null, restrictedNotes: restrictedNotes ?? null, reviewStatus: v.reviewStatus },
    });
    const occ = await tx.attendanceOccurrence.update({ where: { id: created.id }, data: { searchText: occurrenceSearchText(created, type) } });
    await audit(tx, {
      actorId: actor.id,
      action: "CREATE",
      entityType: "AttendanceOccurrence",
      entityId: occ.id,
      summary: `Ocorrência ${formatCode("occurrence", occ.code)} (${type.name}) registrada para ${formatCode("employee", employee.code)}`,
      after: occ,
    });
    return occ;
  });
}

/** Correção com motivo obrigatório; a auditoria guarda os valores anteriores. */
export async function updateOccurrence(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "attendance:write");
  const { reason } = z.object({ reason: requiredText("o motivo da correção", 500) }).parse(raw);
  const before = await db.attendanceOccurrence.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new NotFoundError("Ocorrência não encontrada.");
  if (before.adjustmentId) throw new ValidationError("Ocorrências geradas por ajuste de escala são corrigidas pela escala.");
  const { v, type, startMinute, endMinute, restrictedNotes } = await parseOccurrence(db, actor, raw);
  const base = { employeeId: v.employeeId, typeId: v.typeId, date: v.date, startMinute, endMinute };
  await assertNoDuplicate(db, base, id);
  return db.$transaction(async (tx) => {
    const occ = await tx.attendanceOccurrence.update({
      where: { id },
      data: {
        ...base,
        adminNotes: v.adminNotes ?? null,
        // Sem permissão restrita, o conteúdo restrito existente é preservado
        ...(restrictedNotes !== undefined ? { restrictedNotes } : {}),
        reviewStatus: v.reviewStatus,
        searchText: occurrenceSearchText({ code: before.code, date: v.date, adminNotes: v.adminNotes ?? null }, type),
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: "CORRECT",
      entityType: "AttendanceOccurrence",
      entityId: id,
      summary: `Ocorrência ${formatCode("occurrence", occ.code)} corrigida`,
      before,
      after: occ,
      reason,
    });
    return occ;
  });
}

export async function setReviewStatus(db: Db, actor: Actor, id: string, status: ReviewStatus) {
  assertCan(actor, "attendance:write");
  return db.$transaction(async (tx) => {
    const before = await tx.attendanceOccurrence.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Ocorrência não encontrada.");
    const occ = await tx.attendanceOccurrence.update({ where: { id }, data: { reviewStatus: status } });
    await audit(tx, { actorId: actor.id, action: "REVIEW", entityType: "AttendanceOccurrence", entityId: id, summary: `Conferência de ${formatCode("occurrence", occ.code)} atualizada`, before, after: occ });
    return occ;
  });
}

/** Exclusão lógica com motivo (o registro permanece para auditoria). */
export async function deleteOccurrence(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "attendance:write");
  const { reason } = z.object({ reason: requiredText("o motivo da exclusão", 500) }).parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.attendanceOccurrence.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Ocorrência não encontrada.");
    if (before.adjustmentId) throw new ValidationError("Revogue o ajuste de escala correspondente.");
    await tx.attendanceOccurrence.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "AttendanceOccurrence", entityId: id, summary: `Ocorrência ${formatCode("occurrence", before.code)} excluída`, before, reason });
  });
}

export type OccurrenceFilters = {
  employeeId?: string;
  typeId?: string;
  reviewStatus?: ReviewStatus;
  from?: Date;
  to?: Date;
  q?: string;
  page?: number;
};

export async function listOccurrences(db: Db, actor: Actor, f: OccurrenceFilters) {
  assertCan(actor, "attendance:read");
  const where: Prisma.AttendanceOccurrenceWhereInput = { deletedAt: null };
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.typeId) where.typeId = f.typeId;
  if (f.reviewStatus) where.reviewStatus = f.reviewStatus;
  if (f.from || f.to) where.date = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  const q = normalizeQuery(f.q);
  if (q) where.OR = [{ searchText: { contains: q } }, { employee: { searchText: { contains: q } } }];
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.attendanceOccurrence.count({ where }),
    db.attendanceOccurrence.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, code: true } }, type: true, _count: { select: { attachments: { where: { deletedAt: null } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, page, pageCount: Math.ceil(total / PAGE_SIZE), items: items.map((o) => redactOccurrence(actor, o)) };
}

/** Remove campos restritos quando o usuário não tem permissão. */
export function redactOccurrence<T extends { restrictedNotes: string | null }>(actor: Actor, o: T): T & { hasRestricted: boolean } {
  const hasRestricted = Boolean(o.restrictedNotes);
  if (can(actor, "attendance:restricted")) return { ...o, hasRestricted };
  return { ...o, restrictedNotes: null, hasRestricted };
}

export async function getOccurrence(db: Db, actor: Actor, id: string) {
  assertCan(actor, "attendance:read");
  const o = await db.attendanceOccurrence.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, code: true } },
      type: true,
      adjustment: true,
      attachments: can(actor, "attendance:restricted") ? { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } : false,
    },
  });
  if (!o || o.deletedAt) throw new NotFoundError("Ocorrência não encontrada.");
  return redactOccurrence(actor, o);
}

export async function listOccurrenceTypes(db: Db, actor: Actor, opts: { includeInactive?: boolean } = {}) {
  assertCan(actor, "attendance:read");
  return db.occurrenceType.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] });
}

const typeSchema = z.object({
  name: requiredText("o nome", 80),
  countsAsAbsence: z.preprocess((v) => v === "on", z.boolean()),
  requiresTimeRange: z.preprocess((v) => v === "on", z.boolean()),
  isMedical: z.preprocess((v) => v === "on", z.boolean()),
});

/** Outras ocorrências administrativas configuráveis. */
export async function createOccurrenceType(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "settings:manage");
  const v = typeSchema.parse(raw);
  const code = `CUSTOM_${normalizeQuery(v.name).replace(/[^a-z0-9]+/g, "_").toUpperCase().slice(0, 40)}`;
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.occurrenceType.create({ data: { ...v, code, isSystem: false } });
      await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "OccurrenceType", entityId: t.id, summary: `Tipo de ocorrência "${t.name}" criado`, after: t });
      return t;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe um tipo com este nome.", { name: "Nome já utilizado." });
    throw e;
  }
}

export async function toggleOccurrenceType(db: Db, actor: Actor, id: string) {
  assertCan(actor, "settings:manage");
  const t = await db.occurrenceType.findUnique({ where: { id } });
  if (!t) throw new NotFoundError();
  if (t.isSystem) throw new ValidationError("Tipos do sistema não podem ser desativados.");
  return db.$transaction(async (tx) => {
    const updated = await tx.occurrenceType.update({ where: { id }, data: { active: !t.active } });
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "OccurrenceType", entityId: id, summary: `Tipo "${t.name}" ${updated.active ? "ativado" : "desativado"}`, before: t, after: updated });
    return updated;
  });
}

// ───────────── Anexos privados ─────────────

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Verifica o tipo real do arquivo pela assinatura (não confia na extensão/mime enviados). */
export function detectMime(bytes: Uint8Array): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function attachmentsDir(): string {
  return path.resolve(env().ATTACHMENTS_DIR);
}

export async function addAttachment(db: Db, actor: Actor, occurrenceId: string, file: { name: string; bytes: Uint8Array }) {
  assertCan(actor, "attendance:restricted");
  const occ = await db.attendanceOccurrence.findUnique({ where: { id: occurrenceId } });
  if (!occ || occ.deletedAt) throw new NotFoundError("Ocorrência não encontrada.");
  if (file.bytes.length === 0) throw new ValidationError("Selecione um arquivo.", { file: "Arquivo vazio." });
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new ValidationError("Arquivo maior que 10 MB.", { file: "Limite de 10 MB." });
  const mime = detectMime(file.bytes);
  if (!mime) throw new ValidationError("Formato não permitido. Envie PDF, PNG ou JPG.", { file: "Use PDF, PNG ou JPG." });
  const storedName = `${randomUUID()}.bin`;
  const dir = attachmentsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedName), file.bytes, { mode: 0o600, flag: "wx" });
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const originalName = path.basename(file.name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "anexo";
  return db.$transaction(async (tx) => {
    const a = await tx.attachment.create({
      data: { occurrenceId, originalName, storedName, mimeType: mime, sizeBytes: file.bytes.length, sha256, uploadedById: actor.id },
    });
    await audit(tx, { actorId: actor.id, action: "ATTACH", entityType: "AttendanceOccurrence", entityId: occurrenceId, summary: `Anexo adicionado à ocorrência ${formatCode("occurrence", occ.code)}` });
    return a;
  });
}

export async function readAttachment(db: Db, actor: Actor, id: string) {
  if (!can(actor, "attendance:restricted")) throw new ForbiddenError();
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a || a.deletedAt) throw new NotFoundError("Anexo não encontrado.");
  // storedName é gerado pelo sistema; ainda assim, impede qualquer travessia de diretório.
  if (!/^[0-9a-f-]{36}\.bin$/.test(a.storedName)) throw new NotFoundError("Anexo não encontrado.");
  const bytes = await readFile(path.join(attachmentsDir(), a.storedName));
  await audit(db, { actorId: actor.id, action: "VIEW_ATTACHMENT", entityType: "Attachment", entityId: id, summary: "Anexo restrito acessado" });
  return { bytes, mimeType: a.mimeType, originalName: a.originalName };
}

export async function removeAttachment(db: Db, actor: Actor, id: string) {
  assertCan(actor, "attendance:restricted");
  return db.$transaction(async (tx) => {
    const a = await tx.attachment.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundError("Anexo não encontrado.");
    await tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "Attachment", entityId: id, summary: "Anexo removido (arquivo mantido para auditoria)" });
  });
}

// ───────────── Consolidação e calendário ─────────────

async function occurrencesForCalc(db: Db, employeeIds: string[], from: Date, to: Date) {
  return db.attendanceOccurrence.findMany({
    where: { employeeId: { in: employeeIds }, deletedAt: null, date: { gte: from, lte: to } },
    include: { type: { select: { countsAsAbsence: true, name: true, isMedical: true, code: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
}

export async function employeeAttendanceSummary(db: Db, actor: Actor, employeeId: string, from: Date, to: Date): Promise<AttendanceSummary> {
  assertCan(actor, "attendance:read");
  const rules = await loadRules(db, employeeId);
  const occs = await occurrencesForCalc(db, [employeeId], from, to);
  return summarizeAttendance(
    rules.assignments,
    rules.adjustments,
    occs.map((o) => ({ ...o, countsAsAbsence: o.type.countsAsAbsence })),
    from,
    to,
  );
}

export type TeamAttendanceRow = {
  employee: { id: string; fullName: string; code: number; team: string; jobTitle: string; status: string };
  summary: AttendanceSummary;
  occurrenceCount: number;
  pendingReview: number;
  byType: Record<string, number>;
};

export async function teamAttendanceSummary(db: Db, actor: Actor, from: Date, to: Date, filter: { employeeId?: string; team?: string } = {}): Promise<TeamAttendanceRow[]> {
  assertCan(actor, "attendance:read");
  const employees = await db.employee.findMany({
    where: {
      ...(filter.employeeId ? { id: filter.employeeId } : { status: { not: "INACTIVE" } }),
      ...(filter.team ? { team: filter.team } : {}),
    },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, code: true, team: true, jobTitle: true, status: true },
  });
  const occs = await occurrencesForCalc(db, employees.map((e) => e.id), from, to);
  const rows: TeamAttendanceRow[] = [];
  for (const employee of employees) {
    const mine = occs.filter((o) => o.employeeId === employee.id);
    const rules = await loadRules(db, employee.id);
    const summary = summarizeAttendance(rules.assignments, rules.adjustments, mine.map((o) => ({ ...o, countsAsAbsence: o.type.countsAsAbsence })), from, to);
    const byType: Record<string, number> = {};
    for (const o of mine) if (o.reviewStatus !== "DISREGARDED") byType[o.type.name] = (byType[o.type.name] ?? 0) + 1;
    rows.push({
      employee,
      summary,
      occurrenceCount: mine.filter((o) => o.reviewStatus !== "DISREGARDED").length,
      pendingReview: mine.filter((o) => o.reviewStatus === "PENDING").length,
      byType,
    });
  }
  return rows;
}

export type CalendarDay = DayPlan & {
  occurrences: Array<{ id: string; code: number; typeName: string; startMinute: number | null; endMinute: number | null; reviewStatus: ReviewStatus }>;
};

export async function employeeCalendar(db: Db, actor: Actor, employeeId: string, month: Date) {
  assertCan(actor, "attendance:read");
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const rules = await loadRules(db, employeeId);
  const occs = await occurrencesForCalc(db, [employeeId], from, to);
  const days: CalendarDay[] = planRange(rules.assignments, rules.adjustments, from, to).map((p) => ({
    ...p,
    occurrences: occs
      .filter((o) => toDateKey(o.date) === p.dateKey)
      .map((o) => ({ id: o.id, code: o.code, typeName: o.type.name, startMinute: o.startMinute, endMinute: o.endMinute, reviewStatus: o.reviewStatus })),
  }));
  const summary = summarizeAttendance(rules.assignments, rules.adjustments, occs.map((o) => ({ ...o, countsAsAbsence: o.type.countsAsAbsence })), from, to);
  const adjustments = await db.shiftAdjustment.findMany({
    where: { employeeId, date: { gte: from, lte: to } },
    include: { swapWith: { select: { fullName: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return { days, summary, adjustments, assignments: rules.assignments };
}

export async function planForDate(db: Db, employeeId: string, date: Date) {
  const rules = await loadRules(db, employeeId);
  return planDay(rules.assignments, rules.adjustments, date);
}
