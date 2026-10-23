import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { addDays, addMonths, dayNumber, endOfMonth, formatDate, monthKey, monthRange, startOfMonth, toDateKey, todayInTimeZone } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { formatCode } from "@/lib/text";
import { dateField, decimalField, intField, optionalText, PAGE_SIZE, requiredText, uuidField } from "@/lib/validation";

/**
 * Indicadores lançados por semana (segunda a domingo), tipicamente às sextas-feiras.
 * Uma semana pertence ao mês/período da sua sexta-feira. Agregações:
 *   chamados = soma · tempo médio e avaliação = média ponderada pelo volume de chamados
 *   (média simples quando não há chamados).
 */

function appToday(): Date {
  return todayInTimeZone(process.env.APP_TIMEZONE || "America/Sao_Paulo");
}

/** Segunda-feira da semana de uma data. */
export function weekStartOf(date: Date): Date {
  const wd = date.getUTCDay(); // 0 = domingo
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** Sexta-feira da semana (define a qual mês/período a semana pertence). */
export function fridayOf(weekStart: Date): Date {
  return addDays(weekStart, 4);
}

export function weekLabel(weekStart: Date): string {
  return `${formatDate(weekStart).slice(0, 5)} a ${formatDate(addDays(weekStart, 6))}`;
}

/** Filtro de semanas cuja sexta-feira cai em [from, to]. */
function weeksWhere(from: Date, to: Date): Prisma.DateTimeFilter {
  return { gte: addDays(from, -4), lte: addDays(to, -4) };
}

const values = {
  ticketsHandled: intField("a quantidade de chamados", 0, 1_000_000),
  avgHandleMinutes: decimalField("o tempo médio (min)", 0, 100_000),
  avgRating: decimalField("a avaliação média", 0, 10),
  notes: optionalText(1000),
};

/** `week` aceita qualquer data da semana; é normalizada para a segunda-feira. */
export const metricSchema = z.object({ employeeId: uuidField("o colaborador"), week: dateField("a semana"), ...values });

function assertNotFuture(weekStart: Date, today: Date) {
  if (dayNumber(weekStart) > dayNumber(today)) throw new ValidationError("Não é possível lançar métricas de semanas futuras.", { week: "Semana futura." });
}

/** Lançamento individual de uma semana (um por colaborador e semana). */
export async function createMetric(db: Db, actor: Actor, raw: unknown, today: Date = appToday()) {
  assertCan(actor, "metrics:write");
  const { week, ...v } = metricSchema.parse(raw);
  const weekStart = weekStartOf(week);
  assertNotFuture(weekStart, today);
  const employee = await db.employee.findUnique({ where: { id: v.employeeId } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  const existing = await db.weeklyMetric.findUnique({ where: { employeeId_weekStart: { employeeId: v.employeeId, weekStart } } });
  if (existing) {
    throw new ConflictError(`Já existe lançamento da semana ${weekLabel(weekStart)} para este colaborador. Corrija o lançamento existente.`, { week: "Semana já lançada." });
  }
  try {
    return await db.$transaction(async (tx) => {
      const m = await tx.weeklyMetric.create({ data: { ...v, weekStart, notes: v.notes ?? null, jobTitleSnapshot: employee.jobTitle, teamSnapshot: employee.team } });
      await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "WeeklyMetric", entityId: m.id, summary: `Métricas da semana ${weekLabel(weekStart)} lançadas para ${formatCode("employee", employee.code)}`, after: m });
      return m;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe lançamento para este colaborador nesta semana.", { week: "Semana já lançada." });
    throw e;
  }
}

type RowInput = { ticketsHandled?: string; avgHandleMinutes?: string; avgRating?: string; notes?: string };

/**
 * Lançamento da semana para toda a equipe de uma vez. O formulário envia, por colaborador,
 * os campos t_<id>, a_<id>, r_<id> e n_<id>. Linhas totalmente vazias são ignoradas.
 * Valores alterados em lançamentos já existentes geram revisão (o valor anterior é preservado).
 */
export async function saveWeeklyBatch(db: Db, actor: Actor, raw: Record<string, unknown>, today: Date = appToday()) {
  assertCan(actor, "metrics:write");
  const { week } = z.object({ week: dateField("a semana") }).parse(raw);
  const weekStart = weekStartOf(week);
  assertNotFuture(weekStart, today);

  const rows = new Map<string, RowInput>();
  for (const [key, value] of Object.entries(raw)) {
    const m = /^([tarn])_([0-9a-f-]{36})$/.exec(key);
    if (!m || typeof value !== "string") continue;
    const row = rows.get(m[2]) ?? {};
    const field = { t: "ticketsHandled", a: "avgHandleMinutes", r: "avgRating", n: "notes" }[m[1]] as keyof RowInput;
    row[field] = value;
    rows.set(m[2], row);
  }

  const rowSchema = z.object(values);
  const fieldErrors: Record<string, string> = {};
  const parsed: Array<{ employeeId: string } & z.infer<typeof rowSchema>> = [];
  for (const [employeeId, row] of rows) {
    const filled = [row.ticketsHandled, row.avgHandleMinutes, row.avgRating].filter((x) => x !== undefined && x.trim() !== "");
    if (filled.length === 0 && !row.notes?.trim()) continue;
    const r = rowSchema.safeParse(row);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const short = { ticketsHandled: "t", avgHandleMinutes: "a", avgRating: "r", notes: "n" }[String(issue.path[0]) as keyof RowInput];
        fieldErrors[`${short}_${employeeId}`] ??= issue.message;
      }
      continue;
    }
    parsed.push({ employeeId, ...r.data });
  }
  if (Object.keys(fieldErrors).length) throw new ValidationError("Revise as linhas destacadas.", fieldErrors);
  if (parsed.length === 0) throw new ValidationError("Preencha ao menos um colaborador.");

  return db.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({ where: { id: { in: parsed.map((p) => p.employeeId) } } });
    const byId = new Map(employees.map((e) => [e.id, e]));
    const existing = await tx.weeklyMetric.findMany({ where: { weekStart, employeeId: { in: parsed.map((p) => p.employeeId) } } });
    const existingBy = new Map(existing.map((e) => [e.employeeId, e]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const p of parsed) {
      const emp = byId.get(p.employeeId);
      if (!emp) throw new ValidationError("Colaborador inválido no lançamento.");
      const data = { ticketsHandled: p.ticketsHandled, avgHandleMinutes: p.avgHandleMinutes, avgRating: p.avgRating, notes: p.notes ?? null };
      const before = existingBy.get(p.employeeId);
      if (!before) {
        const m = await tx.weeklyMetric.create({ data: { ...data, employeeId: p.employeeId, weekStart, jobTitleSnapshot: emp.jobTitle, teamSnapshot: emp.team } });
        await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "WeeklyMetric", entityId: m.id, summary: `Métricas da semana ${weekLabel(weekStart)} lançadas para ${formatCode("employee", emp.code)}`, after: m });
        created++;
        continue;
      }
      const same =
        before.ticketsHandled === data.ticketsHandled &&
        Number(before.avgHandleMinutes) === data.avgHandleMinutes &&
        Number(before.avgRating) === data.avgRating &&
        (before.notes ?? null) === data.notes;
      if (same) {
        unchanged++;
        continue;
      }
      await tx.weeklyMetricRevision.create({
        data: {
          metricId: before.id,
          ticketsHandled: before.ticketsHandled,
          avgHandleMinutes: before.avgHandleMinutes,
          avgRating: before.avgRating,
          notes: before.notes,
          reason: "Ajuste no lançamento da semana",
          changedById: actor.id,
        },
      });
      const after = await tx.weeklyMetric.update({ where: { id: before.id }, data });
      await audit(tx, { actorId: actor.id, action: "CORRECT", entityType: "WeeklyMetric", entityId: before.id, summary: `Métricas da semana ${weekLabel(weekStart)} ajustadas`, before, after, reason: "Ajuste no lançamento da semana" });
      updated++;
    }
    return { created, updated, unchanged, weekStart };
  });
}

const correctionSchema = z.object({ ...values, reason: requiredText("o motivo da correção", 500) });

/** Corrige um lançamento guardando os valores anteriores em WeeklyMetricRevision. */
export async function correctMetric(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "metrics:write");
  const v = correctionSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.weeklyMetric.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Lançamento não encontrado.");
    const unchanged =
      before.ticketsHandled === v.ticketsHandled &&
      Number(before.avgHandleMinutes) === v.avgHandleMinutes &&
      Number(before.avgRating) === v.avgRating &&
      (before.notes ?? null) === (v.notes ?? null);
    if (unchanged) throw new ValidationError("Nenhum valor foi alterado.");
    await tx.weeklyMetricRevision.create({
      data: { metricId: id, ticketsHandled: before.ticketsHandled, avgHandleMinutes: before.avgHandleMinutes, avgRating: before.avgRating, notes: before.notes, reason: v.reason, changedById: actor.id },
    });
    const after = await tx.weeklyMetric.update({
      where: { id },
      data: { ticketsHandled: v.ticketsHandled, avgHandleMinutes: v.avgHandleMinutes, avgRating: v.avgRating, notes: v.notes ?? null },
    });
    await audit(tx, { actorId: actor.id, action: "CORRECT", entityType: "WeeklyMetric", entityId: id, summary: `Métricas da semana ${weekLabel(before.weekStart)} corrigidas`, before, after, reason: v.reason });
    return after;
  });
}

export async function getMetric(db: Db, actor: Actor, id: string) {
  assertCan(actor, "metrics:read");
  const m = await db.weeklyMetric.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true, code: true } }, revisions: { orderBy: { createdAt: "desc" } } },
  });
  if (!m) throw new NotFoundError("Lançamento não encontrado.");
  return m;
}

export async function listMetrics(
  db: Db,
  actor: Actor,
  f: { employeeId?: string; from?: Date; to?: Date; team?: string; page?: number; sort?: string; dir?: "asc" | "desc" },
) {
  assertCan(actor, "metrics:read");
  const where: Prisma.WeeklyMetricWhereInput = {};
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.team) where.teamSnapshot = f.team;
  if (f.from && f.to) where.weekStart = weeksWhere(f.from, f.to);
  const dir = f.dir ?? "desc";
  const orderBy: Prisma.WeeklyMetricOrderByWithRelationInput[] =
    f.sort === "tickets"
      ? [{ ticketsHandled: dir }]
      : f.sort === "rating"
        ? [{ avgRating: dir }]
        : f.sort === "aht"
          ? [{ avgHandleMinutes: dir }]
          : f.sort === "employee"
            ? [{ employee: { fullName: dir } }]
            : [{ weekStart: dir }, { employee: { fullName: "asc" } }];
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.weeklyMetric.count({ where }),
    db.weeklyMetric.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, code: true } }, _count: { select: { revisions: true } } },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

/** Dados do formulário de lançamento da semana: equipe ativa + lançamentos já existentes. */
export async function weeklyBatchData(db: Db, actor: Actor, weekStart: Date) {
  assertCan(actor, "metrics:read");
  const [employees, entries] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: "INACTIVE" }, startDate: { lte: addDays(weekStart, 6) } },
      select: { id: true, fullName: true, code: true, jobTitle: true, team: true, status: true },
      orderBy: [{ team: "asc" }, { fullName: "asc" }],
    }),
    db.weeklyMetric.findMany({ where: { weekStart } }),
  ]);
  const byEmployee = new Map(entries.map((e) => [e.employeeId, e]));
  return employees.map((e) => ({ employee: e, metric: byEmployee.get(e.id) ?? null }));
}

// ───────────── Séries e agregações ─────────────

export type SeriesPoint = {
  /** AAAA-MM (série mensal) ou AAAA-MM-DD (segunda-feira da semana) */
  month: string;
  tickets: number | null;
  aht: number | null;
  rating: number | null;
  /** Quantidade de lançamentos agregados no ponto */
  count: number;
};

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Row = { ticketsHandled: number; avgHandleMinutes: Prisma.Decimal | number; avgRating: Prisma.Decimal | number };

/** Agrega lançamentos: soma de chamados; tempo médio e avaliação ponderados pelos chamados. */
export function combine(rows: Row[]): { tickets: number | null; aht: number | null; rating: number | null; count: number } {
  if (rows.length === 0) return { tickets: null, aht: null, rating: null, count: 0 };
  const tickets = rows.reduce((s, r) => s + r.ticketsHandled, 0);
  const weighted = (pick: (r: Row) => number) =>
    tickets > 0 ? rows.reduce((s, r) => s + pick(r) * r.ticketsHandled, 0) / tickets : rows.reduce((s, r) => s + pick(r), 0) / rows.length;
  return { tickets, aht: round2(weighted((r) => Number(r.avgHandleMinutes))), rating: round2(weighted((r) => Number(r.avgRating))), count: rows.length };
}

type Scope = { employeeId?: string; team?: string; jobTitle?: string };

function scopeWhere(s: Scope): Prisma.WeeklyMetricWhereInput {
  return {
    ...(s.employeeId ? { employeeId: s.employeeId } : {}),
    ...(s.team ? { teamSnapshot: s.team } : {}),
    ...(s.jobTitle ? { jobTitleSnapshot: s.jobTitle } : {}),
  };
}

/** Série mensal (semana conta no mês da sua sexta-feira; meses vazios ficam nulos). */
export async function metricSeries(db: Db, actor: Actor, opts: { months: number; end?: Date } & Scope): Promise<SeriesPoint[]> {
  assertCan(actor, "metrics:read");
  const end = startOfMonth(opts.end ?? appToday());
  const start = addMonths(end, -(opts.months - 1));
  const rows = await db.weeklyMetric.findMany({
    where: { weekStart: weeksWhere(start, endOfMonth(end)), ...scopeWhere(opts) },
    select: { weekStart: true, ticketsHandled: true, avgHandleMinutes: true, avgRating: true },
  });
  return monthRange(start, end).map((m) => {
    const key = monthKey(m);
    return { month: key, ...combine(rows.filter((r) => monthKey(fridayOf(r.weekStart)) === key)) };
  });
}

/** Série semanal: as últimas N semanas até a semana de `end` (semanas vazias ficam nulas). */
export async function weeklySeries(db: Db, actor: Actor, opts: { weeks: number; end?: Date } & Scope): Promise<SeriesPoint[]> {
  assertCan(actor, "metrics:read");
  const last = weekStartOf(opts.end ?? appToday());
  const first = addDays(last, -7 * (opts.weeks - 1));
  const rows = await db.weeklyMetric.findMany({
    where: { weekStart: { gte: first, lte: last }, ...scopeWhere(opts) },
    select: { weekStart: true, ticketsHandled: true, avgHandleMinutes: true, avgRating: true },
  });
  return Array.from({ length: opts.weeks }, (_, i) => {
    const ws = addDays(first, 7 * i);
    const key = toDateKey(ws);
    return { month: key, ...combine(rows.filter((r) => toDateKey(r.weekStart) === key)) };
  });
}

export type PeriodAggregate = { tickets: number | null; aht: number | null; rating: number | null; months: number };

/** Agregado das semanas cuja sexta-feira cai no período. */
export async function periodAggregate(db: Db, actor: Actor, opts: { from: Date; to: Date } & Scope) {
  assertCan(actor, "metrics:read");
  const rows = await db.weeklyMetric.findMany({
    where: { weekStart: weeksWhere(opts.from, opts.to), ...scopeWhere(opts) },
    select: { weekStart: true, ticketsHandled: true, avgHandleMinutes: true, avgRating: true },
  });
  return { ...combine(rows), weeks: new Set(rows.map((r) => toDateKey(r.weekStart))).size };
}

/** Agrega pontos de uma série (para totais do período). */
export function aggregate(points: SeriesPoint[]): PeriodAggregate {
  const filled = points.filter((p) => p.tickets !== null);
  if (filled.length === 0) return { tickets: null, aht: null, rating: null, months: 0 };
  const c = combine(filled.map((p) => ({ ticketsHandled: p.tickets ?? 0, avgHandleMinutes: p.aht ?? 0, avgRating: p.rating ?? 0 })));
  return { tickets: c.tickets, aht: c.aht, rating: c.rating, months: filled.length };
}

/**
 * Comparação entre colaboradores em contexto equivalente (mesma função e equipe) em um
 * mês. Valores lado a lado, sem ranking nem classificação.
 */
export async function peerComparison(db: Db, actor: Actor, opts: { month: Date; team?: string; jobTitle?: string }) {
  assertCan(actor, "metrics:read");
  const rows = await db.weeklyMetric.findMany({
    where: { weekStart: weeksWhere(startOfMonth(opts.month), endOfMonth(opts.month)), ...scopeWhere(opts) },
    include: { employee: { select: { id: true, fullName: true, code: true } } },
  });
  const byEmployee = new Map<string, typeof rows>();
  for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  return [...byEmployee.values()]
    .map((list) => ({ employee: list[0].employee, jobTitle: list[0].jobTitleSnapshot, team: list[0].teamSnapshot, weeks: list.length, ...combine(list) }))
    .sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName, "pt-BR"));
}

/** Colaboradores ativos sem lançamento na semana informada. */
export async function employeesWithoutMetric(db: Db, actor: Actor, weekStart: Date) {
  assertCan(actor, "metrics:read");
  const rows = await weeklyBatchData(db, actor, weekStart);
  return rows.filter((r) => r.employee.status === "ACTIVE" && r.metric === null).map((r) => ({ id: r.employee.id, fullName: r.employee.fullName, code: r.employee.code }));
}

// ───────────── Relatório semanal ─────────────

export type WeeklyReportRow = {
  employeeId: string;
  code: number;
  name: string;
  team: string;
  jobTitle: string;
  tickets: number;
  aht: number;
  rating: number;
  notes: string | null;
  prev: { tickets: number; aht: number; rating: number } | null;
};

/** Dados do relatório de uma semana, com comparação à semana anterior. */
export async function weeklyReportData(db: Db, actor: Actor, week: Date, scope: Scope = {}) {
  assertCan(actor, "metrics:read");
  const weekStart = weekStartOf(week);
  const prevStart = addDays(weekStart, -7);
  const [current, previous] = await Promise.all([
    db.weeklyMetric.findMany({ where: { weekStart, ...scopeWhere(scope) }, include: { employee: { select: { fullName: true, code: true } } } }),
    db.weeklyMetric.findMany({ where: { weekStart: prevStart, ...scopeWhere(scope) } }),
  ]);
  const prevBy = new Map(previous.map((p) => [p.employeeId, p]));
  const rows: WeeklyReportRow[] = current
    .map((m) => {
      const p = prevBy.get(m.employeeId);
      return {
        employeeId: m.employeeId,
        code: m.employee.code,
        name: m.employee.fullName,
        team: m.teamSnapshot,
        jobTitle: m.jobTitleSnapshot,
        tickets: m.ticketsHandled,
        aht: Number(m.avgHandleMinutes),
        rating: Number(m.avgRating),
        notes: m.notes,
        prev: p ? { tickets: p.ticketsHandled, aht: Number(p.avgHandleMinutes), rating: Number(p.avgRating) } : null,
      };
    })
    .sort((a, b) => a.team.localeCompare(b.team, "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
  return { weekStart, weekEnd: addDays(weekStart, 6), rows, total: combine(current), previousTotal: combine(previous) };
}
