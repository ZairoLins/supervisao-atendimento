import { z } from "zod";
import type { Db, Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, dayNumber, formatDate, timeRangeFromInputs } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { formatCode } from "@/lib/text";
import { dateField, optionalDateField, optionalText, optionalTimeField, requiredText, uuidField } from "@/lib/validation";
import {
  planDay,
  validateSegments,
  validityOverlaps,
  type AdjustmentRule,
  type AssignmentRule,
  type Segment,
  type ScheduleSegment,
} from "./rules";
import { occurrenceSearchText } from "./occurrences";

// ───────────── Modelos de jornada ─────────────

const scheduleBase = z.object({
  name: requiredText("o nome da jornada", 120),
  description: optionalText(500),
  kind: z.enum(["WEEKLY", "ROTATION"], { error: "Tipo inválido." }),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
  cycleDays: z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)), z.number().int().min(2).max(14).optional()),
  workOffsets: z.preprocess(
    (v) => (typeof v === "string" ? v.split(/[,; ]+/).filter(Boolean).map(Number) : v),
    z.array(z.number().int().min(0).max(13)).default([]),
  ),
  start1: optionalTimeField(),
  end1: optionalTimeField(),
  start2: optionalTimeField(),
  end2: optionalTimeField(),
  start3: optionalTimeField(),
  end3: optionalTimeField(),
  // Horário específico de sábado e domingo (jornada semanal)
  satStart: optionalTimeField(),
  satEnd: optionalTimeField(),
  sunStart: optionalTimeField(),
  sunEnd: optionalTimeField(),
});

/** Converte o formulário em regra validada (trechos podem atravessar a meia-noite). */
export function parseScheduleInput(raw: unknown) {
  const v = scheduleBase.parse(raw);
  // Cada período começa no dia do turno; o fim pode cair no dia seguinte (ex.: 19:00–07:00).
  const segments: Segment[] = [];
  for (const [s, e] of [
    [v.start1, v.end1],
    [v.start2, v.end2],
    [v.start3, v.end3],
  ] as const) {
    if (!s && !e) continue;
    if (!s || !e) throw new ValidationError("Informe início e fim de cada período.", { start1: "Período incompleto." });
    segments.push(timeRangeFromInputs(s, e));
  }
  segments.sort((a, b) => a.startMinute - b.startMinute);
  const err = validateSegments(segments);
  if (err) throw new ValidationError(err, { start1: err });

  // Sábado/domingo com horário próprio (substitui os períodos comuns naquele dia)
  const specific: ScheduleSegment[] = [];
  const weekdays = new Set(v.weekdays);
  if (v.kind === "WEEKLY") {
    for (const [wd, st, en, field] of [
      [6, v.satStart, v.satEnd, "satStart"],
      [0, v.sunStart, v.sunEnd, "sunStart"],
    ] as const) {
      if (!st && !en) continue;
      if (!st || !en) throw new ValidationError("Informe início e fim do horário específico.", { [field]: "Período incompleto." });
      const r = timeRangeFromInputs(st, en);
      const e2 = validateSegments([r]);
      if (e2) throw new ValidationError(e2, { [field]: e2 });
      specific.push({ ...r, weekday: wd });
      weekdays.add(wd);
    }
  }
  if (v.kind === "WEEKLY" && weekdays.size === 0) throw new ValidationError("Selecione os dias da semana.", { weekdays: "Selecione ao menos um dia." });
  if (v.kind === "ROTATION") {
    if (!v.cycleDays) throw new ValidationError("Informe o tamanho do ciclo.", { cycleDays: "Obrigatório para revezamento." });
    if (v.workOffsets.length === 0 || v.workOffsets.some((o) => o >= v.cycleDays!)) {
      throw new ValidationError("Dias de trabalho do ciclo inválidos.", { workOffsets: `Use posições entre 0 e ${v.cycleDays - 1}.` });
    }
  }
  return {
    name: v.name,
    description: v.description ?? null,
    kind: v.kind,
    weekdays: v.kind === "WEEKLY" ? [...weekdays].sort((a, b) => a - b) : [],
    cycleDays: v.kind === "ROTATION" ? v.cycleDays! : null,
    workOffsets: v.kind === "ROTATION" ? [...new Set(v.workOffsets)].sort() : [],
    segments: [...segments.map((x) => ({ ...x, weekday: null })), ...specific] as ScheduleSegment[],
  };
}

export async function createSchedule(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "attendance:write");
  const rule = parseScheduleInput(raw);
  try {
    return await db.$transaction(async (tx) => {
      const { segments, ...data } = rule;
      const schedule = await tx.workSchedule.create({
        data: { ...data, segments: { create: segments.map((s, i) => ({ position: i, ...s })) } },
      });
      await audit(tx, {
        actorId: actor.id,
        action: "CREATE",
        entityType: "WorkSchedule",
        entityId: schedule.id,
        summary: `Jornada "${schedule.name}" criada`,
        after: { ...schedule, segments: JSON.stringify(segments) },
      });
      return schedule;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe uma jornada com este nome.", { name: "Nome já utilizado." });
    throw e;
  }
}

/**
 * Jornadas já atribuídas não têm a regra alterada (preserva o histórico): apenas nome,
 * descrição e situação. Para mudar horários, crie um novo modelo e atribua com nova vigência.
 */
export async function updateSchedule(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "attendance:write");
  const existing = await db.workSchedule.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
  if (!existing) throw new NotFoundError("Jornada não encontrada.");
  const meta = z
    .object({ name: requiredText("o nome da jornada", 120), description: optionalText(500), active: z.preprocess((v) => v === "on", z.boolean()) })
    .parse(raw);
  try {
    return await db.$transaction(async (tx) => {
      if (existing._count.assignments === 0) {
        const rule = parseScheduleInput(raw);
        const { segments, ...data } = rule;
        await tx.workScheduleSegment.deleteMany({ where: { scheduleId: id } });
        await tx.workSchedule.update({
          where: { id },
          data: { ...data, active: meta.active, segments: { create: segments.map((s, i) => ({ position: i, ...s })) } },
        });
      } else {
        await tx.workSchedule.update({ where: { id }, data: { name: meta.name, description: meta.description ?? null, active: meta.active } });
      }
      const after = await tx.workSchedule.findUniqueOrThrow({ where: { id } });
      await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "WorkSchedule", entityId: id, summary: `Jornada "${after.name}" atualizada`, before: existing, after });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe uma jornada com este nome.", { name: "Nome já utilizado." });
    throw e;
  }
}

export async function listSchedules(db: Db, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  assertCan(actor, "attendance:read");
  return db.workSchedule.findMany({
    where: opts.activeOnly ? { active: true } : {},
    include: { segments: { orderBy: { position: "asc" } }, _count: { select: { assignments: true } } },
    orderBy: { name: "asc" },
  });
}

// ───────────── Atribuições (histórico de vigência) ─────────────

const assignmentSchema = z.object({
  employeeId: uuidField("o colaborador"),
  scheduleId: uuidField("a jornada"),
  validFrom: dateField("o início da vigência"),
  cycleReferenceDate: optionalDateField(),
  notes: optionalText(500),
});

/**
 * Atribui jornada a partir de uma data. A atribuição aberta anterior é encerrada no dia
 * anterior (histórico preservado). Não permite sobreposição de vigências.
 */
export async function assignSchedule(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "attendance:write");
  const v = assignmentSchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      const [employee, schedule] = await Promise.all([
        tx.employee.findUnique({ where: { id: v.employeeId } }),
        tx.workSchedule.findUnique({ where: { id: v.scheduleId } }),
      ]);
      if (!employee) throw new NotFoundError("Colaborador não encontrado.");
      if (!schedule || !schedule.active) throw new ValidationError("Jornada inválida ou inativa.", { scheduleId: "Selecione uma jornada ativa." });
      if (schedule.kind === "ROTATION" && !v.cycleReferenceDate) {
        throw new ValidationError("Informe a data de referência do ciclo.", {
          cycleReferenceDate: "Obrigatória para escalas de revezamento (ex.: 12x36): uma data de plantão.",
        });
      }
      const existing = await tx.employeeScheduleAssignment.findMany({ where: { employeeId: v.employeeId }, orderBy: { validFrom: "asc" } });
      const later = existing.find((a) => dayNumber(a.validFrom) >= dayNumber(v.validFrom));
      if (later) {
        throw new ConflictError(`Já existe jornada atribuída a partir de ${formatDate(later.validFrom)}. Escolha uma data posterior.`, {
          validFrom: "Conflita com uma vigência existente.",
        });
      }
      const open = existing.find((a) => a.validTo === null);
      if (open) {
        await tx.employeeScheduleAssignment.update({ where: { id: open.id }, data: { validTo: addDays(v.validFrom, -1) } });
      }
      const refreshed = await tx.employeeScheduleAssignment.findMany({ where: { employeeId: v.employeeId } });
      const candidate = { validFrom: v.validFrom, validTo: null };
      if (refreshed.some((a) => validityOverlaps(a, candidate))) {
        throw new ConflictError("A vigência informada se sobrepõe a outra atribuição.", { validFrom: "Sobreposição de vigência." });
      }
      const assignment = await tx.employeeScheduleAssignment.create({
        data: {
          employeeId: v.employeeId,
          scheduleId: v.scheduleId,
          validFrom: v.validFrom,
          cycleReferenceDate: schedule.kind === "ROTATION" ? v.cycleReferenceDate! : null,
          notes: v.notes ?? null,
        },
      });
      await audit(tx, {
        actorId: actor.id,
        action: "ASSIGN_SCHEDULE",
        entityType: "Employee",
        entityId: v.employeeId,
        summary: `Jornada "${schedule.name}" atribuída a ${formatCode("employee", employee.code)} a partir de ${formatDate(v.validFrom)}`,
        after: assignment,
      });
      return assignment;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function endAssignment(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "attendance:write");
  const { validTo } = z.object({ validTo: dateField("o fim da vigência") }).parse(raw);
  return db.$transaction(async (tx) => {
    const a = await tx.employeeScheduleAssignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundError("Atribuição não encontrada.");
    if (dayNumber(validTo) < dayNumber(a.validFrom)) throw new ValidationError("O fim deve ser igual ou posterior ao início.", { validTo: "Data inválida." });
    const updated = await tx.employeeScheduleAssignment.update({ where: { id }, data: { validTo } });
    await audit(tx, { actorId: actor.id, action: "END_SCHEDULE", entityType: "Employee", entityId: a.employeeId, summary: `Vigência de jornada encerrada em ${formatDate(validTo)}`, before: a, after: updated });
    return updated;
  });
}

/**
 * Exclui uma vigência lançada por engano. Se ela foi a última e encerrou automaticamente
 * a anterior, a anterior volta a valer com o mesmo fim que a excluída tinha.
 * Ocorrências e ajustes não são apagados; o registro fica na auditoria.
 */
export async function deleteAssignment(db: Db, actor: Actor, id: string) {
  assertCan(actor, "attendance:write");
  return db.$transaction(
    async (tx) => {
      const a = await tx.employeeScheduleAssignment.findUnique({ where: { id }, include: { schedule: { select: { name: true } } } });
      if (!a) throw new NotFoundError("Atribuição não encontrada.");
      const all = await tx.employeeScheduleAssignment.findMany({ where: { employeeId: a.employeeId }, orderBy: { validFrom: "asc" } });
      const isLatest = all[all.length - 1]?.id === a.id;
      const previous = all.filter((x) => dayNumber(x.validFrom) < dayNumber(a.validFrom)).at(-1);
      await tx.employeeScheduleAssignment.delete({ where: { id } });
      let reopened = false;
      if (isLatest && previous?.validTo && dayNumber(previous.validTo) === dayNumber(a.validFrom) - 1) {
        await tx.employeeScheduleAssignment.update({ where: { id: previous.id }, data: { validTo: a.validTo } });
        reopened = true;
      }
      await audit(tx, {
        actorId: actor.id,
        action: "DELETE_SCHEDULE",
        entityType: "Employee",
        entityId: a.employeeId,
        summary: `Vigência "${a.schedule.name}" de ${formatDate(a.validFrom)} excluída${reopened ? " (vigência anterior reaberta)" : ""}`,
        before: a,
      });
      return { employeeId: a.employeeId, reopened };
    },
    { isolationLevel: "Serializable" },
  );
}

// ───────────── Carregamento das regras ─────────────

export async function loadRules(db: Db | Tx, employeeId: string): Promise<{ assignments: AssignmentRule[]; adjustments: AdjustmentRule[] }> {
  const [assignments, adjustments] = await Promise.all([
    db.employeeScheduleAssignment.findMany({
      where: { employeeId },
      include: { schedule: { include: { segments: { orderBy: { position: "asc" } } } } },
      orderBy: { validFrom: "asc" },
    }),
    db.shiftAdjustment.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    assignments: assignments.map((a) => ({
      id: a.id,
      validFrom: a.validFrom,
      validTo: a.validTo,
      cycleReferenceDate: a.cycleReferenceDate,
      schedule: {
        id: a.schedule.id,
        name: a.schedule.name,
        kind: a.schedule.kind,
        weekdays: a.schedule.weekdays,
        cycleDays: a.schedule.cycleDays,
        workOffsets: a.schedule.workOffsets,
        segments: a.schedule.segments.map((s) => ({ startMinute: s.startMinute, endMinute: s.endMinute, weekday: s.weekday })),
      },
    })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      date: a.date,
      kind: a.kind,
      startMinute: a.startMinute,
      endMinute: a.endMinute,
      revokedAt: a.revokedAt,
      reason: a.reason,
    })),
  };
}

// ───────────── Trocas e ajustes de escala ─────────────

const adjustmentSchema = z.object({
  employeeId: uuidField("o colaborador"),
  date: dateField(),
  kind: z.enum(["DAY_OFF", "CUSTOM_HOURS"], { error: "Selecione o tipo de ajuste." }),
  startTime: optionalTimeField(),
  endTime: optionalTimeField(),
  reason: requiredText("o motivo", 500),
  swapWithEmployeeId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
});

function shiftWindow(segments: Segment[]): { startMinute: number; endMinute: number } | null {
  if (segments.length === 0) return null;
  return { startMinute: segments[0].startMinute, endMinute: segments[segments.length - 1].endMinute };
}

/**
 * Registra ajuste sobre a escala prevista (sem apagá-la). Com "troca", o colaborador
 * cede o turno da data ao colega: ele fica de folga e o colega assume o mesmo horário.
 * Cada ajuste gera uma ocorrência de frequência (troca de plantão/ajuste de escala).
 */
export async function createAdjustment(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "attendance:write");
  const v = adjustmentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: v.employeeId } });
    if (!employee) throw new NotFoundError("Colaborador não encontrado.");
    const rules = await loadRules(tx, v.employeeId);
    const plan = planDay(rules.assignments, rules.adjustments, v.date);

    let start: number | null = null;
    let end: number | null = null;
    if (v.kind === "CUSTOM_HOURS") {
      if (!v.startTime || !v.endTime) throw new ValidationError("Informe o horário ajustado.", { startTime: "Obrigatório." });
      const r = timeRangeFromInputs(v.startTime, v.endTime);
      start = r.startMinute;
      end = r.endMinute;
    }
    if (v.swapWithEmployeeId) {
      if (v.kind !== "DAY_OFF") throw new ValidationError("Na troca, o colaborador cede o turno: use o tipo Folga.", { kind: "Use Folga para troca." });
      if (v.swapWithEmployeeId === v.employeeId) throw new ValidationError("Selecione outro colaborador para a troca.", { swapWithEmployeeId: "Inválido." });
      if (!plan.effective.isWorkDay) throw new ValidationError("Não há turno previsto nesta data para ceder.", { date: "Sem turno previsto." });
    }

    const codeType = v.swapWithEmployeeId ? "TROCA_PLANTAO" : "AJUSTE_ESCALA";
    const type = await tx.occurrenceType.findUnique({ where: { code: codeType } });
    if (!type) throw new ValidationError("Tipos de ocorrência do sistema ausentes. Execute a carga inicial (seed).");

    const adjustment = await tx.shiftAdjustment.create({
      data: { employeeId: v.employeeId, date: v.date, kind: v.kind, startMinute: start, endMinute: end, reason: v.reason, swapWithEmployeeId: v.swapWithEmployeeId ?? null },
    });
    await tx.attendanceOccurrence.create({
      data: {
        employeeId: v.employeeId,
        typeId: type.id,
        date: v.date,
        adminNotes: v.reason,
        adjustmentId: adjustment.id,
        reviewStatus: "CONFIRMED",
        searchText: "",
      },
    });

    if (v.swapWithEmployeeId) {
      const other = await tx.employee.findUnique({ where: { id: v.swapWithEmployeeId } });
      if (!other) throw new NotFoundError("Colaborador da troca não encontrado.");
      const window = shiftWindow(plan.effective.segments)!;
      const mirrored = await tx.shiftAdjustment.create({
        data: {
          employeeId: other.id,
          date: v.date,
          kind: "CUSTOM_HOURS",
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          reason: `Troca com ${employee.fullName}: ${v.reason}`,
          swapWithEmployeeId: v.employeeId,
        },
      });
      await tx.attendanceOccurrence.create({
        data: { employeeId: other.id, typeId: type.id, date: v.date, adminNotes: `Assume turno de ${employee.fullName}. ${v.reason}`, adjustmentId: mirrored.id, reviewStatus: "CONFIRMED" },
      });
    }
    await refreshOccurrenceSearchText(tx, { adjustmentEmployeeIds: [v.employeeId, v.swapWithEmployeeId].filter(Boolean) as string[], date: v.date });
    await audit(tx, {
      actorId: actor.id,
      action: v.swapWithEmployeeId ? "SHIFT_SWAP" : "SHIFT_ADJUST",
      entityType: "Employee",
      entityId: v.employeeId,
      summary: `${v.swapWithEmployeeId ? "Troca de plantão" : "Ajuste de escala"} em ${formatDate(v.date)} para ${formatCode("employee", employee.code)}`,
      after: adjustment,
    });
    return adjustment;
  });
}

/** Revoga o ajuste (e o espelho da troca), mantendo o registro para auditoria. */
export async function revokeAdjustment(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "attendance:write");
  const { reason } = z.object({ reason: requiredText("o motivo da revogação", 500) }).parse(raw);
  return db.$transaction(async (tx) => {
    const adj = await tx.shiftAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundError("Ajuste não encontrado.");
    if (adj.revokedAt) throw new ValidationError("Este ajuste já foi revogado.");
    const ids = [id];
    if (adj.swapWithEmployeeId) {
      const mirror = await tx.shiftAdjustment.findFirst({
        where: { employeeId: adj.swapWithEmployeeId, swapWithEmployeeId: adj.employeeId, date: adj.date, revokedAt: null },
      });
      if (mirror) ids.push(mirror.id);
    }
    const now = new Date();
    await tx.shiftAdjustment.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now, revokedReason: reason } });
    await tx.attendanceOccurrence.updateMany({ where: { adjustmentId: { in: ids } }, data: { reviewStatus: "DISREGARDED" } });
    await audit(tx, { actorId: actor.id, action: "SHIFT_REVOKE", entityType: "Employee", entityId: adj.employeeId, summary: `Ajuste de escala de ${formatDate(adj.date)} revogado`, reason });
  });
}

/** Mantém o texto indexável das ocorrências geradas por ajustes. */
async function refreshOccurrenceSearchText(tx: Tx, where: { adjustmentEmployeeIds: string[]; date: Date }) {
  const rows = await tx.attendanceOccurrence.findMany({
    where: { employeeId: { in: where.adjustmentEmployeeIds }, date: where.date, searchText: "" },
    include: { type: true },
  });
  for (const r of rows) {
    await tx.attendanceOccurrence.update({ where: { id: r.id }, data: { searchText: occurrenceSearchText(r, r.type) } });
  }
}
