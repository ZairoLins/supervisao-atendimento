import type { Db } from "@/lib/db";
import { addMonths, endOfMonth, monthKey, monthRange, startOfMonth } from "@/lib/dates";
import { can, type Actor } from "@/lib/permissions";
import { aggregate, employeesWithoutMetric, metricSeries } from "@/modules/metrics/service";

export type DashboardFilters = { fromMonth: Date; toMonth: Date; employeeId?: string };

/**
 * Indicadores da dashboard calculados exclusivamente a partir do banco. Cada bloco
 * só é carregado quando o usuário tem permissão no módulo correspondente.
 */
export async function loadDashboard(db: Db, actor: Actor, f: DashboardFilters, today: Date) {
  const from = startOfMonth(f.fromMonth);
  const to = endOfMonth(f.toMonth);
  const months = monthRange(from, to).length;
  const prevTo = endOfMonth(addMonths(from, -1));
  const prevFrom = startOfMonth(addMonths(from, -months));
  const emp = f.employeeId ? { employeeId: f.employeeId } : {};

  const [activeEmployees, totalEmployees] = can(actor, "employees:read")
    ? await Promise.all([db.employee.count({ where: { status: "ACTIVE" } }), db.employee.count()])
    : [null, null];

  let attendance: null | {
    occurrences: number;
    previous: number;
    pendingReview: number;
    byMonth: Record<string, number>;
    byType: Array<{ name: string; count: number }>;
  } = null;
  if (can(actor, "attendance:read")) {
    const base = { deletedAt: null, reviewStatus: { not: "DISREGARDED" as const }, type: { countsAsAbsence: true }, ...emp };
    const [rows, previous, pendingReview] = await Promise.all([
      db.attendanceOccurrence.findMany({ where: { ...base, date: { gte: from, lte: to } }, select: { date: true, type: { select: { name: true } } } }),
      db.attendanceOccurrence.count({ where: { ...base, date: { gte: prevFrom, lte: prevTo } } }),
      db.attendanceOccurrence.count({ where: { deletedAt: null, reviewStatus: "PENDING", ...emp } }),
    ]);
    const byMonth: Record<string, number> = {};
    const types: Record<string, number> = {};
    for (const r of rows) {
      byMonth[monthKey(r.date)] = (byMonth[monthKey(r.date)] ?? 0) + 1;
      types[r.type.name] = (types[r.type.name] ?? 0) + 1;
    }
    attendance = {
      occurrences: rows.length,
      previous,
      pendingReview,
      byMonth,
      byType: Object.entries(types)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  let metrics: null | {
    series: Awaited<ReturnType<typeof metricSeries>>;
    current: ReturnType<typeof aggregate>;
    previous: ReturnType<typeof aggregate>;
    missingLastMonth: Array<{ id: string; fullName: string; code: number }>;
  } = null;
  if (can(actor, "metrics:read")) {
    const [series, prevSeries, missing] = await Promise.all([
      metricSeries(db, actor, { months, end: from.getTime() <= to.getTime() ? startOfMonth(to) : from, employeeId: f.employeeId }),
      metricSeries(db, actor, { months, end: startOfMonth(prevTo), employeeId: f.employeeId }),
      employeesWithoutMetric(db, actor, addMonths(startOfMonth(today), -1)),
    ]);
    metrics = { series, current: aggregate(series), previous: aggregate(prevSeries), missingLastMonth: f.employeeId ? missing.filter((m) => m.id === f.employeeId) : missing };
  }

  let tasks: null | {
    open: number;
    overdue: number;
    overdueList: Array<{ id: string; title: string; dueDate: Date | null; priority: string; code: number }>;
  } = null;
  if (can(actor, "tasks:read")) {
    const taskWhere = { deletedAt: null, status: { in: ["PENDING" as const, "IN_PROGRESS" as const] }, ...(f.employeeId ? { OR: [{ employeeId: f.employeeId }, { assigneeEmployeeId: f.employeeId }] } : {}) };
    const [open, overdue, overdueList] = await Promise.all([
      db.task.count({ where: taskWhere }),
      db.task.count({ where: { ...taskWhere, dueDate: { lt: today } } }),
      db.task.findMany({ where: { ...taskWhere, dueDate: { lt: today } }, orderBy: { dueDate: "asc" }, take: 5, select: { id: true, title: true, dueDate: true, priority: true, code: true } }),
    ]);
    tasks = { open, overdue, overdueList };
  }

  const upcomingMeetings = can(actor, "meetings:read")
    ? await db.meeting.findMany({
        where: { deletedAt: null, status: "SCHEDULED", date: { gte: today }, ...(f.employeeId ? { participants: { some: { employeeId: f.employeeId } } } : {}) },
        orderBy: [{ date: "asc" }, { startMinute: "asc" }],
        take: 5,
        include: { _count: { select: { agendaItems: true } } },
      })
    : null;

  const followUps = can(actor, "feedbacks:read")
    ? await db.feedback.findMany({
        where: { deletedAt: null, status: { not: "CLOSED" }, followUpDate: { lte: today }, ...emp },
        orderBy: { followUpDate: "asc" },
        take: 5,
        include: { employee: { select: { fullName: true } } },
      })
    : null;

  const withoutSchedule = can(actor, "attendance:read")
    ? await db.employee.findMany({
        where: {
          status: "ACTIVE",
          ...(f.employeeId ? { id: f.employeeId } : {}),
          scheduleAssignments: { none: { validFrom: { lte: today }, OR: [{ validTo: null }, { validTo: { gte: today } }] } },
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
        take: 10,
      })
    : null;

  return { period: { from, to, months }, activeEmployees, totalEmployees, attendance, metrics, tasks, upcomingMeetings, followUps, withoutSchedule };
}
