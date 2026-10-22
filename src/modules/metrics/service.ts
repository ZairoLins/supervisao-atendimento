import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { addMonths, formatMonthLong, monthKey, monthRange, startOfMonth } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { formatCode } from "@/lib/text";
import { decimalField, intField, monthField, optionalText, PAGE_SIZE, requiredText, uuidField } from "@/lib/validation";

export const metricSchema = z.object({
  employeeId: uuidField("o colaborador"),
  month: monthField(),
  ticketsHandled: intField("a quantidade de chamados", 0, 1_000_000),
  avgHandleMinutes: decimalField("o tempo médio (min)", 0, 100_000),
  avgRating: decimalField("a avaliação média", 0, 10),
  notes: optionalText(2000),
});

export async function createMetric(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "metrics:write");
  const v = metricSchema.parse(raw);
  const employee = await db.employee.findUnique({ where: { id: v.employeeId } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  const existing = await db.monthlyMetric.findUnique({ where: { employeeId_month: { employeeId: v.employeeId, month: v.month } } });
  if (existing) {
    throw new ConflictError(`Já existe lançamento de ${formatMonthLong(v.month)} para este colaborador. Use a correção do lançamento existente.`, {
      month: "Mês já lançado para o colaborador.",
    });
  }
  try {
    return await db.$transaction(async (tx) => {
      const m = await tx.monthlyMetric.create({
        data: { ...v, notes: v.notes ?? null, jobTitleSnapshot: employee.jobTitle, teamSnapshot: employee.team },
      });
      await audit(tx, {
        actorId: actor.id,
        action: "CREATE",
        entityType: "MonthlyMetric",
        entityId: m.id,
        summary: `Métricas de ${monthKey(v.month)} lançadas para ${formatCode("employee", employee.code)}`,
        after: m,
      });
      return m;
    });
  } catch (e) {
    // Corrida entre dois envios simultâneos: a restrição única do banco garante a integridade.
    if (isUniqueViolation(e)) throw new ConflictError("Já existe lançamento para este colaborador e mês.", { month: "Mês já lançado." });
    throw e;
  }
}

const correctionSchema = metricSchema.pick({ ticketsHandled: true, avgHandleMinutes: true, avgRating: true, notes: true }).extend({
  reason: requiredText("o motivo da correção", 500),
});

/** Corrige um lançamento guardando os valores anteriores em MonthlyMetricRevision. */
export async function correctMetric(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "metrics:write");
  const v = correctionSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.monthlyMetric.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Lançamento não encontrado.");
    const unchanged =
      before.ticketsHandled === v.ticketsHandled &&
      Number(before.avgHandleMinutes) === v.avgHandleMinutes &&
      Number(before.avgRating) === v.avgRating &&
      (before.notes ?? null) === (v.notes ?? null);
    if (unchanged) throw new ValidationError("Nenhum valor foi alterado.");
    await tx.monthlyMetricRevision.create({
      data: {
        metricId: id,
        ticketsHandled: before.ticketsHandled,
        avgHandleMinutes: before.avgHandleMinutes,
        avgRating: before.avgRating,
        notes: before.notes,
        reason: v.reason,
        changedById: actor.id,
      },
    });
    const after = await tx.monthlyMetric.update({
      where: { id },
      data: { ticketsHandled: v.ticketsHandled, avgHandleMinutes: v.avgHandleMinutes, avgRating: v.avgRating, notes: v.notes ?? null },
    });
    await audit(tx, { actorId: actor.id, action: "CORRECT", entityType: "MonthlyMetric", entityId: id, summary: `Métricas de ${monthKey(before.month)} corrigidas`, before, after, reason: v.reason });
    return after;
  });
}

export async function getMetric(db: Db, actor: Actor, id: string) {
  assertCan(actor, "metrics:read");
  const m = await db.monthlyMetric.findUnique({
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
  const where: Prisma.MonthlyMetricWhereInput = {};
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.team) where.teamSnapshot = f.team;
  if (f.from || f.to) where.month = { ...(f.from ? { gte: startOfMonth(f.from) } : {}), ...(f.to ? { lte: startOfMonth(f.to) } : {}) };
  const dir = f.dir ?? "desc";
  const orderBy: Prisma.MonthlyMetricOrderByWithRelationInput[] =
    f.sort === "tickets"
      ? [{ ticketsHandled: dir }]
      : f.sort === "rating"
        ? [{ avgRating: dir }]
        : f.sort === "aht"
          ? [{ avgHandleMinutes: dir }]
          : f.sort === "employee"
            ? [{ employee: { fullName: dir } }]
            : [{ month: dir }, { employee: { fullName: "asc" } }];
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.monthlyMetric.count({ where }),
    db.monthlyMetric.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, code: true } }, _count: { select: { revisions: true } } },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

// ───────────── Séries históricas ─────────────

export type SeriesPoint = {
  month: string;
  tickets: number | null;
  aht: number | null;
  rating: number | null;
  /** Quantidade de colaboradores com lançamento (para a visão de equipe) */
  count: number;
};

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Série mensal com meses sem registro explícitos (valores nulos — não zero).
 * Na visão de equipe: chamados = soma; tempo médio = média ponderada por chamados;
 * avaliação = média simples dos colaboradores com lançamento.
 */
export async function metricSeries(
  db: Db,
  actor: Actor,
  opts: { months: number; end?: Date; employeeId?: string; team?: string; jobTitle?: string },
): Promise<SeriesPoint[]> {
  assertCan(actor, "metrics:read");
  const end = startOfMonth(opts.end ?? new Date());
  const start = addMonths(end, -(opts.months - 1));
  const rows = await db.monthlyMetric.findMany({
    where: {
      month: { gte: start, lte: end },
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(opts.team ? { teamSnapshot: opts.team } : {}),
      ...(opts.jobTitle ? { jobTitleSnapshot: opts.jobTitle } : {}),
    },
    select: { month: true, ticketsHandled: true, avgHandleMinutes: true, avgRating: true },
  });
  return monthRange(start, end).map((m) => {
    const key = monthKey(m);
    const inMonth = rows.filter((r) => monthKey(r.month) === key);
    if (inMonth.length === 0) return { month: key, tickets: null, aht: null, rating: null, count: 0 };
    const tickets = inMonth.reduce((s, r) => s + r.ticketsHandled, 0);
    const weighted = inMonth.reduce((s, r) => s + Number(r.avgHandleMinutes) * r.ticketsHandled, 0);
    const aht = tickets > 0 ? weighted / tickets : inMonth.reduce((s, r) => s + Number(r.avgHandleMinutes), 0) / inMonth.length;
    const rating = inMonth.reduce((s, r) => s + Number(r.avgRating), 0) / inMonth.length;
    return { month: key, tickets, aht: round2(aht), rating: round2(rating), count: inMonth.length };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PeriodAggregate = { tickets: number | null; aht: number | null; rating: number | null; months: number };

export function aggregate(points: SeriesPoint[]): PeriodAggregate {
  const filled = points.filter((p) => p.tickets !== null);
  if (filled.length === 0) return { tickets: null, aht: null, rating: null, months: 0 };
  const tickets = filled.reduce((s, p) => s + (p.tickets ?? 0), 0);
  const aht = tickets > 0 ? filled.reduce((s, p) => s + (p.aht ?? 0) * (p.tickets ?? 0), 0) / tickets : null;
  const rating = filled.reduce((s, p) => s + (p.rating ?? 0), 0) / filled.length;
  return { tickets, aht: aht === null ? null : round2(aht), rating: round2(rating), months: filled.length };
}

/**
 * Comparação entre colaboradores em contexto equivalente (mesma função e equipe no mês).
 * Mostra valores lado a lado, sem ranking nem classificação.
 */
export async function peerComparison(db: Db, actor: Actor, opts: { month: Date; team?: string; jobTitle?: string }) {
  assertCan(actor, "metrics:read");
  const month = startOfMonth(opts.month);
  return db.monthlyMetric.findMany({
    where: { month, ...(opts.team ? { teamSnapshot: opts.team } : {}), ...(opts.jobTitle ? { jobTitleSnapshot: opts.jobTitle } : {}) },
    include: { employee: { select: { id: true, fullName: true, code: true } } },
    orderBy: { employee: { fullName: "asc" } },
  });
}

/** Colaboradores ativos sem lançamento no mês informado. */
export async function employeesWithoutMetric(db: Db, actor: Actor, month: Date) {
  assertCan(actor, "metrics:read");
  const m = startOfMonth(month);
  return db.employee.findMany({
    where: { status: "ACTIVE", startDate: { lte: addMonths(m, 1) }, metrics: { none: { month: m } } },
    select: { id: true, fullName: true, code: true },
    orderBy: { fullName: "asc" },
  });
}
