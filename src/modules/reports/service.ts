import { z } from "zod";
import type { Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addMonths, dayNumber, endOfMonth, formatDate, formatDuration, formatMonth, formatTimeRange, isValidDateKey, parseDateKey, startOfMonth } from "@/lib/dates";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { FEEDBACK_STATUS, FEEDBACK_TYPE, MEETING_STATUS, MEETING_TYPE, REVIEW_STATUS, TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { assertCan, can, type Actor } from "@/lib/permissions";
import { formatCode } from "@/lib/text";
import { teamAttendanceSummary } from "@/modules/attendance/occurrences";
import { metricSeries, pctChange } from "@/modules/metrics/service";
import { REPORT_KINDS, REPORT_LABELS, type ReportData, type ReportKind } from "./types";

const dateParam = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isValidDateKey(v), "Data inválida.")
  .transform((v) => (v ? parseDateKey(v) : undefined));

export const reportParamsSchema = z
  .object({
    tipo: z.enum(REPORT_KINDS, { error: "Relatório inválido." }),
    formato: z.enum(["xlsx", "pdf"], { error: "Formato inválido." }),
    de: dateParam,
    ate: dateParam,
    colaborador: z.string().uuid("Colaborador inválido.").optional().or(z.literal("").transform(() => undefined)),
    status: z.string().max(40).optional(),
    categoria: z.string().max(80).optional(),
    observacoes: z.enum(["1"]).optional(),
    confirmar: z.enum(["1"]).optional(),
    detalhes: z.enum(["1"]).optional(),
  })
  .refine((v) => !v.de || !v.ate || dayNumber(v.de) <= dayNumber(v.ate), { message: "A data inicial deve ser anterior à final.", path: ["de"] })
  .refine((v) => !v.de || !v.ate || dayNumber(v.ate) - dayNumber(v.de) <= 366 * 3, { message: "Período máximo de 3 anos.", path: ["ate"] });

export type ReportParams = z.infer<typeof reportParamsSchema>;

function periodLabel(from: Date, to: Date) {
  return `Período: ${formatDate(from)} a ${formatDate(to)}`;
}

function defaultPeriod(p: ReportParams, today: Date, monthsBack = 0) {
  const to = p.ate ?? endOfMonth(today);
  const from = p.de ?? startOfMonth(addMonths(to, -monthsBack));
  return { from, to };
}

async function employeeName(db: Db, id?: string) {
  if (!id) return null;
  const e = await db.employee.findUnique({ where: { id }, select: { fullName: true } });
  if (!e) throw new NotFoundError("Colaborador não encontrado.");
  return e.fullName;
}

const builders: Record<ReportKind, (db: Db, actor: Actor, p: ReportParams, today: Date) => Promise<ReportData>> = {
  async metricas(db, actor, p, today) {
    assertCan(actor, "metrics:read");
    const { from, to } = defaultPeriod(p, today, 5);
    const rows = await db.monthlyMetric.findMany({
      where: {
        month: { gte: startOfMonth(from), lte: startOfMonth(to) },
        ...(p.colaborador ? { employeeId: p.colaborador } : {}),
        ...(p.categoria ? { teamSnapshot: p.categoria } : {}),
      },
      include: { employee: { select: { fullName: true, code: true } }, _count: { select: { revisions: true } } },
      orderBy: [{ month: "asc" }, { employee: { fullName: "asc" } }],
    });
    const tickets = rows.reduce((s, r) => s + r.ticketsHandled, 0);
    const weighted = rows.reduce((s, r) => s + Number(r.avgHandleMinutes) * r.ticketsHandled, 0);
    const name = await employeeName(db, p.colaborador);
    return {
      title: REPORT_LABELS.metricas.title,
      meta: [periodLabel(from, to), ...(name ? [`Colaborador: ${name}`] : []), ...(p.categoria ? [`Equipe: ${p.categoria}`] : [])],
      generatedAt: new Date(),
      columns: [
        { key: "month", header: "Mês", width: 10 },
        { key: "code", header: "ID", width: 10 },
        { key: "name", header: "Colaborador", width: 30 },
        { key: "team", header: "Equipe (no mês)", width: 18 },
        { key: "tickets", header: "Chamados", width: 11, kind: "number" },
        { key: "aht", header: "TMA (min)", width: 11, kind: "decimal" },
        { key: "rating", header: "Avaliação", width: 11, kind: "decimal" },
        { key: "revisions", header: "Correções", width: 10, kind: "number" },
        { key: "notes", header: "Observações", width: 36 },
      ],
      rows: rows.map((r) => ({
        month: formatMonth(r.month),
        code: formatCode("employee", r.employee.code),
        name: r.employee.fullName,
        team: r.teamSnapshot,
        tickets: r.ticketsHandled,
        aht: Number(r.avgHandleMinutes),
        rating: Number(r.avgRating),
        revisions: r._count.revisions,
        notes: r.notes,
      })),
      totals: rows.length
        ? {
            month: "Total",
            tickets,
            aht: tickets ? Math.round((weighted / tickets) * 100) / 100 : null,
            rating: Math.round((rows.reduce((s, r) => s + Number(r.avgRating), 0) / rows.length) * 100) / 100,
          }
        : undefined,
      notes: ["TMA total ponderado pelo volume de chamados; avaliação total é a média simples dos lançamentos.", "Volume maior não indica, por si só, melhor desempenho."],
    };
  },

  async desempenho(db, actor, p, today) {
    assertCan(actor, "metrics:read");
    if (!p.colaborador) throw new ValidationError("Selecione o colaborador.", { colaborador: "Obrigatório para este relatório." });
    const name = await employeeName(db, p.colaborador);
    const { from, to } = defaultPeriod(p, today, 11);
    const months = Math.min(36, Math.max(1, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1));
    const series = await metricSeries(db, actor, { months, end: to, employeeId: p.colaborador });
    return {
      title: REPORT_LABELS.desempenho.title,
      meta: [`Colaborador: ${name}`, periodLabel(from, to)],
      generatedAt: new Date(),
      columns: [
        { key: "month", header: "Mês", width: 12 },
        { key: "tickets", header: "Chamados", width: 12, kind: "number" },
        { key: "dTickets", header: "Var. chamados (%)", width: 14, kind: "decimal" },
        { key: "aht", header: "TMA (min)", width: 12, kind: "decimal" },
        { key: "dAht", header: "Var. TMA (%)", width: 12, kind: "decimal" },
        { key: "rating", header: "Avaliação", width: 12, kind: "decimal" },
        { key: "dRating", header: "Var. avaliação (%)", width: 14, kind: "decimal" },
      ],
      rows: series.map((s, i) => {
        const prev = series[i - 1];
        const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
        return {
          month: `${formatMonth(new Date(`${s.month}-01T00:00:00Z`))}${s.tickets === null ? " (sem registro)" : ""}`,
          tickets: s.tickets,
          dTickets: r2(pctChange(s.tickets, prev?.tickets ?? null)),
          aht: s.aht,
          dAht: r2(pctChange(s.aht, prev?.aht ?? null)),
          rating: s.rating,
          dRating: r2(pctChange(s.rating, prev?.rating ?? null)),
        };
      }),
      notes: ["Variações calculadas em relação ao mês anterior com registro imediatamente antecedente na tabela."],
    };
  },

  async frequencia(db, actor, p, today) {
    assertCan(actor, "attendance:read");
    const { from, to } = defaultPeriod(p, today, 0);
    if (dayNumber(to) - dayNumber(from) > 370) throw new ValidationError("Para frequência, use um período de até 12 meses.", { ate: "Período longo demais." });
    const summary = await teamAttendanceSummary(db, actor, from, to, { employeeId: p.colaborador });
    const occs = await db.attendanceOccurrence.findMany({
      where: {
        deletedAt: null,
        date: { gte: from, lte: to },
        ...(p.colaborador ? { employeeId: p.colaborador } : {}),
        ...(p.status && ["PENDING", "CONFIRMED", "DISREGARDED"].includes(p.status) ? { reviewStatus: p.status as "PENDING" } : {}),
        ...(p.categoria ? { type: { name: p.categoria } } : {}),
      },
      // Seleção explícita: observações restritas e anexos nunca entram no relatório
      select: { code: true, date: true, startMinute: true, endMinute: true, reviewStatus: true, adminNotes: true, type: { select: { name: true, isMedical: true } }, employee: { select: { fullName: true } } },
      orderBy: [{ date: "asc" }],
    });
    const includeNotes = p.observacoes === "1";
    const rows = [
      ...summary.map((r) => ({
        section: "Resumo",
        date: null,
        name: r.employee.fullName,
        type: Object.entries(r.byType).map(([k, v]) => `${k}: ${v}`).join("; ") || "Sem ocorrências",
        time: null,
        planned: formatDuration(r.summary.plannedMinutes),
        absence: formatDuration(r.summary.absenceMinutes),
        status: `${r.summary.plannedDays} turnos / ${r.summary.offDays} folgas`,
        notes: r.pendingReview ? `${r.pendingReview} a conferir` : null,
      })),
      ...occs.map((o) => ({
        section: formatCode("occurrence", o.code),
        date: formatDate(o.date),
        name: o.employee.fullName,
        type: o.type.name,
        time: o.startMinute !== null && o.endMinute !== null ? formatTimeRange(o.startMinute, o.endMinute) : "Dia inteiro",
        planned: null,
        absence: null,
        status: REVIEW_STATUS[o.reviewStatus].label,
        // Observações só com seleção explícita e nunca para tipos médicos
        notes: includeNotes && !o.type.isMedical ? o.adminNotes : null,
      })),
    ];
    const name = await employeeName(db, p.colaborador);
    return {
      title: REPORT_LABELS.frequencia.title,
      meta: [periodLabel(from, to), ...(name ? [`Colaborador: ${name}`] : []), ...(p.categoria ? [`Tipo: ${p.categoria}`] : [])],
      generatedAt: new Date(),
      columns: [
        { key: "section", header: "Registro", width: 12 },
        { key: "date", header: "Data", width: 11 },
        { key: "name", header: "Colaborador", width: 26 },
        { key: "type", header: "Tipo / ocorrências", width: 26 },
        { key: "time", header: "Horário", width: 14 },
        { key: "planned", header: "Previsto", width: 10 },
        { key: "absence", header: "Ausência", width: 10 },
        { key: "status", header: "Situação", width: 18 },
        { key: "notes", header: "Observações", width: 28 },
      ],
      rows,
      totals: summary.length
        ? {
            section: "Total",
            planned: formatDuration(summary.reduce((s, r) => s + r.summary.plannedMinutes, 0)),
            absence: formatDuration(summary.reduce((s, r) => s + r.summary.absenceMinutes, 0)),
          }
        : undefined,
      notes: [
        "Acompanhamento gerencial: não representa cálculo de descontos salariais nem avaliação jurídica de atestados.",
        "Dados médicos, observações restritas e anexos não são incluídos em relatórios.",
      ],
    };
  },

  async reunioes(db, actor, p, today) {
    assertCan(actor, "meetings:read");
    const { from, to } = defaultPeriod(p, today, 2);
    const meetings = await db.meeting.findMany({
      where: {
        deletedAt: null,
        date: { gte: from, lte: to },
        ...(p.status && ["SCHEDULED", "DONE", "CANCELED"].includes(p.status) ? { status: p.status as "DONE" } : {}),
        ...(p.categoria && ["WEEKLY", "EXTRAORDINARY"].includes(p.categoria) ? { type: p.categoria as "WEEKLY" } : {}),
        ...(p.colaborador ? { participants: { some: { employeeId: p.colaborador } } } : {}),
      },
      include: {
        decisions: { orderBy: { position: "asc" } },
        tasks: { where: { deletedAt: null }, include: { assigneeEmployee: { select: { fullName: true } }, assigneeUser: { select: { name: true } } } },
        _count: { select: { participants: true, agendaItems: true } },
      },
      orderBy: { date: "asc" },
    });
    const rows = meetings.flatMap((m) => {
      const base = { code: formatCode("meeting", m.code), date: formatDate(m.date), title: m.title, type: MEETING_TYPE[m.type].label, status: MEETING_STATUS[m.status].label };
      const items = [
        ...m.decisions.map((d) => ({ ...base, kind: "Decisão", item: d.description, owner: null, due: null, itemStatus: null })),
        ...m.tasks.map((t) => ({
          ...base,
          kind: "Ação",
          item: `${formatCode("task", t.code)} ${t.title}`,
          owner: t.assigneeEmployee?.fullName ?? t.assigneeUser?.name ?? null,
          due: t.dueDate ? formatDate(t.dueDate) : null,
          itemStatus: TASK_STATUS[t.status].label,
        })),
      ];
      return items.length ? items : [{ ...base, kind: "—", item: `Sem decisões ou ações · ${m._count.agendaItems} item(ns) de pauta`, owner: null, due: null, itemStatus: null }];
    });
    return {
      title: REPORT_LABELS.reunioes.title,
      meta: [periodLabel(from, to), `${meetings.length} reunião(ões)`],
      generatedAt: new Date(),
      columns: [
        { key: "code", header: "ID", width: 10 },
        { key: "date", header: "Data", width: 11 },
        { key: "title", header: "Reunião", width: 24 },
        { key: "type", header: "Tipo", width: 13 },
        { key: "status", header: "Situação", width: 11 },
        { key: "kind", header: "Registro", width: 9 },
        { key: "item", header: "Descrição", width: 40 },
        { key: "owner", header: "Responsável", width: 18 },
        { key: "due", header: "Prazo", width: 11 },
        { key: "itemStatus", header: "Status", width: 12 },
      ],
      rows,
    };
  },

  async tarefas(db, actor, p, today) {
    assertCan(actor, "tasks:read");
    const statusFilter = p.status && ["PENDING", "IN_PROGRESS", "DONE", "CANCELED"].includes(p.status) ? [p.status] : ["PENDING", "IN_PROGRESS"];
    const tasks = await db.task.findMany({
      where: {
        deletedAt: null,
        status: { in: statusFilter as Array<"PENDING"> },
        ...(p.de || p.ate ? { dueDate: { ...(p.de ? { gte: p.de } : {}), ...(p.ate ? { lte: p.ate } : {}) } } : {}),
        ...(p.colaborador ? { OR: [{ employeeId: p.colaborador }, { assigneeEmployeeId: p.colaborador }] } : {}),
        ...(p.categoria && ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(p.categoria) ? { priority: p.categoria as "LOW" } : {}),
      },
      include: { assigneeEmployee: { select: { fullName: true } }, assigneeUser: { select: { name: true } }, employee: { select: { fullName: true } }, meeting: { select: { title: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    });
    const overdue = tasks.filter((t) => t.dueDate && dayNumber(t.dueDate) < dayNumber(today) && (t.status === "PENDING" || t.status === "IN_PROGRESS")).length;
    return {
      title: REPORT_LABELS.tarefas.title,
      meta: [
        p.de || p.ate ? `Prazo: ${p.de ? formatDate(p.de) : "—"} a ${p.ate ? formatDate(p.ate) : "—"}` : "Todos os prazos",
        `Status: ${statusFilter.map((s) => TASK_STATUS[s as "PENDING"].label).join(", ")}`,
      ],
      generatedAt: new Date(),
      columns: [
        { key: "code", header: "ID", width: 10 },
        { key: "title", header: "Tarefa", width: 34 },
        { key: "priority", header: "Prioridade", width: 11 },
        { key: "status", header: "Status", width: 13 },
        { key: "due", header: "Prazo", width: 11 },
        { key: "late", header: "Atrasada", width: 9 },
        { key: "owner", header: "Responsável", width: 20 },
        { key: "origin", header: "Origem", width: 26 },
      ],
      rows: tasks.map((t) => ({
        code: formatCode("task", t.code),
        title: t.title,
        priority: TASK_PRIORITY[t.priority].label,
        status: TASK_STATUS[t.status].label,
        due: t.dueDate ? formatDate(t.dueDate) : null,
        late: t.dueDate && dayNumber(t.dueDate) < dayNumber(today) && (t.status === "PENDING" || t.status === "IN_PROGRESS") ? "Sim" : "Não",
        owner: t.assigneeEmployee?.fullName ?? t.assigneeUser?.name ?? null,
        origin: t.meeting ? `Reunião: ${t.meeting.title}` : t.employee ? `Colaborador: ${t.employee.fullName}` : t.feedbackId && can(actor, "feedbacks:read") ? "Feedback" : "Manual",
      })),
      totals: { code: "Total", title: `${tasks.length} tarefa(s) · ${overdue} atrasada(s)` },
    };
  },

  async feedbacks(db, actor, p, today) {
    assertCan(actor, "feedbacks:read");
    if (p.confirmar !== "1") throw new ValidationError("Confirme a exportação de feedbacks.", { confirmar: "Seleção explícita obrigatória." });
    const { from, to } = defaultPeriod(p, today, 5);
    const detailed = p.detalhes === "1";
    const rows = await db.feedback.findMany({
      where: {
        deletedAt: null,
        date: { gte: from, lte: to },
        ...(p.colaborador ? { employeeId: p.colaborador } : {}),
        ...(p.status && ["OPEN", "FOLLOW_UP", "CLOSED"].includes(p.status) ? { status: p.status as "OPEN" } : {}),
        ...(p.categoria && Object.keys(FEEDBACK_TYPE).includes(p.categoria) ? { type: p.categoria as "RECOGNITION" } : {}),
      },
      include: { employee: { select: { fullName: true } } },
      orderBy: [{ date: "asc" }],
    });
    const columns: ReportData["columns"] = [
      { key: "code", header: "ID", width: 10 },
      { key: "date", header: "Data", width: 11 },
      { key: "name", header: "Colaborador", width: 24 },
      { key: "type", header: "Tipo", width: 16 },
      { key: "status", header: "Situação", width: 16 },
      { key: "followUp", header: "Acompanhamento", width: 13 },
      ...(detailed
        ? [
            { key: "context", header: "Contexto", width: 30 },
            { key: "positives", header: "Pontos positivos", width: 26 },
            { key: "improvements", header: "A desenvolver", width: 26 },
            { key: "actions", header: "Ações acordadas", width: 26 },
          ]
        : []),
    ];
    return {
      title: REPORT_LABELS.feedbacks.title,
      meta: [periodLabel(from, to), detailed ? "Conteúdo detalhado incluído por seleção explícita" : "Somente dados de controle (sem conteúdo das conversas)"],
      generatedAt: new Date(),
      columns,
      rows: rows.map((f) => ({
        code: formatCode("feedback", f.code),
        date: formatDate(f.date),
        name: f.employee.fullName,
        type: FEEDBACK_TYPE[f.type].label,
        status: FEEDBACK_STATUS[f.status].label,
        followUp: f.followUpDate ? formatDate(f.followUpDate) : null,
        context: f.context,
        positives: f.positives,
        improvements: f.improvements,
        actions: f.agreedActions,
      })),
      notes: ["Documento de uso restrito da supervisão."],
    };
  },
};

export async function buildReport(db: Db, actor: Actor, params: ReportParams, today: Date): Promise<ReportData> {
  if (!can(actor, "reports:export")) throw new ForbiddenError();
  const report = await builders[params.tipo](db, actor, params, today);
  await audit(db, {
    actorId: actor.id,
    action: "EXPORT",
    entityType: "Report",
    entityId: params.tipo,
    summary: `Relatório "${report.title}" exportado (${params.formato.toUpperCase()}, ${report.rows.length} linhas)`,
  });
  return report;
}
