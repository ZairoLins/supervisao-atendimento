import type { Db } from "@/lib/db";
import { formatDate, formatMonth, formatTimeRange, monthKey } from "@/lib/dates";
import { EMPLOYEE_STATUS, FEEDBACK_STATUS, FEEDBACK_TYPE, MEETING_STATUS, NOTE_CATEGORY, TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { can, type Actor, type Permission } from "@/lib/permissions";
import { formatCode, normalizeQuery, normalizeText, parseCodeQuery, truncate, type CodeEntity } from "@/lib/text";
import { parseMonthQuery, scoreMatch } from "./ranking";
import { SEARCH_TYPE_LABEL, SEARCH_TYPES, type SearchGroup, type SearchResponse, type SearchResult, type SearchType } from "./types";

export type SearchOptions = {
  /** Resultados por categoria */
  limit: number;
  types?: SearchType[];
  from?: Date;
  to?: Date;
};

type Ctx = { q: string; raw: string; code: { entity: CodeEntity | null; code: number } | null; take: number; from?: Date; to?: Date };

type Provider = {
  type: SearchType;
  permission: Permission;
  run: (db: Db, actor: Actor, ctx: Ctx) => Promise<SearchResult[]>;
};

function dateRange(ctx: Ctx) {
  if (!ctx.from && !ctx.to) return undefined;
  return { ...(ctx.from ? { gte: ctx.from } : {}), ...(ctx.to ? { lte: ctx.to } : {}) };
}

/**
 * Registros encontrados pelo nome do colaborador relacionado (feedbacks, ocorrências,
 * métricas) ficam abaixo do próprio colaborador e de títulos que correspondem ao termo.
 */
function related(employeeName: string, ctx: Ctx, recency: Date): number {
  return scoreMatch(employeeName, ctx.raw, { recency }) * 0.4;
}

function codeFor(ctx: Ctx, entity: CodeEntity): number | null {
  if (!ctx.code) return null;
  if (ctx.code.entity === null || ctx.code.entity === entity) return ctx.code.code;
  return null;
}

/**
 * Cada provedor declara a permissão do módulo de origem e devolve apenas campos seguros.
 * Termos são sempre passados como parâmetros (Prisma) — nunca concatenados em SQL.
 */
const PROVIDERS: Provider[] = [
  {
    type: "employee",
    permission: "employees:read",
    async run(db, _actor, ctx) {
      const code = codeFor(ctx, "employee");
      const rows = await db.employee.findMany({
        where: { OR: [{ searchText: { contains: ctx.q } }, ...(code !== null ? [{ code }] : [])], ...(ctx.from || ctx.to ? { startDate: dateRange(ctx) } : {}) },
        take: ctx.take,
        orderBy: { fullName: "asc" },
      });
      return rows.map((e) => ({
        type: "employee",
        id: e.id,
        title: e.fullName,
        summary: `${formatCode("employee", e.code)} · ${e.jobTitle} · ${e.team} · ${EMPLOYEE_STATUS[e.status].label}`,
        date: formatDate(e.startDate),
        url: `/colaboradores/${e.id}`,
        score: scoreMatch(e.fullName, ctx.raw, { codeMatch: code === e.code }),
      }));
    },
  },
  {
    type: "team",
    permission: "employees:read",
    async run(db, _actor, ctx) {
      const [teams, titles] = await Promise.all([
        db.employee.groupBy({ by: ["team"], _count: { _all: true }, where: { status: { not: "INACTIVE" } } }),
        db.employee.groupBy({ by: ["jobTitle"], _count: { _all: true }, where: { status: { not: "INACTIVE" } } }),
      ]);
      const out: SearchResult[] = [];
      for (const t of teams) {
        if (normalizeText(t.team).includes(ctx.q)) {
          out.push({ type: "team", id: `team:${t.team}`, title: t.team, summary: `Equipe · ${t._count._all} colaborador(es) ativo(s)`, date: null, url: `/colaboradores?team=${encodeURIComponent(t.team)}`, score: scoreMatch(t.team, ctx.raw) });
        }
      }
      for (const t of titles) {
        if (normalizeText(t.jobTitle).includes(ctx.q)) {
          out.push({ type: "team", id: `title:${t.jobTitle}`, title: t.jobTitle, summary: `Função · ${t._count._all} colaborador(es) ativo(s)`, date: null, url: `/colaboradores?jobTitle=${encodeURIComponent(t.jobTitle)}`, score: scoreMatch(t.jobTitle, ctx.raw) });
        }
      }
      return out.slice(0, ctx.take);
    },
  },
  {
    type: "meeting",
    permission: "meetings:read",
    async run(db, _actor, ctx) {
      const code = codeFor(ctx, "meeting");
      const rows = await db.meeting.findMany({
        where: { deletedAt: null, OR: [{ searchText: { contains: ctx.q } }, ...(code !== null ? [{ code }] : [])], ...(dateRange(ctx) ? { date: dateRange(ctx) } : {}) },
        take: ctx.take,
        orderBy: { date: "desc" },
      });
      return rows.map((m) => ({
        type: "meeting",
        id: m.id,
        title: m.title,
        summary: `${formatCode("meeting", m.code)} · ${MEETING_STATUS[m.status].label} · ${formatTimeRange(m.startMinute, m.endMinute ?? m.startMinute + 60)}`,
        date: formatDate(m.date),
        url: `/reunioes/${m.id}`,
        score: scoreMatch(m.title, ctx.raw, { codeMatch: code === m.code, recency: m.date }),
      }));
    },
  },
  {
    type: "agenda",
    permission: "meetings:read",
    async run(db, _actor, ctx) {
      const rows = await db.meetingAgendaItem.findMany({
        where: { searchText: { contains: ctx.q }, meeting: { deletedAt: null, ...(dateRange(ctx) ? { date: dateRange(ctx) } : {}) } },
        include: { meeting: { select: { id: true, title: true, date: true } } },
        take: ctx.take,
        orderBy: { meeting: { date: "desc" } },
      });
      return rows.map((a) => ({
        type: "agenda",
        id: a.id,
        title: a.title,
        summary: `Pauta de "${truncate(a.meeting.title, 60)}"${a.discussed ? " · discutido" : ""}`,
        date: formatDate(a.meeting.date),
        url: `/reunioes/${a.meeting.id}#pauta`,
        score: scoreMatch(a.title, ctx.raw, { recency: a.meeting.date }),
      }));
    },
  },
  {
    type: "task",
    permission: "tasks:read",
    async run(db, _actor, ctx) {
      const code = codeFor(ctx, "task");
      const rows = await db.task.findMany({
        where: { deletedAt: null, OR: [{ searchText: { contains: ctx.q } }, ...(code !== null ? [{ code }] : [])], ...(dateRange(ctx) ? { dueDate: dateRange(ctx) } : {}) },
        take: ctx.take,
        orderBy: { updatedAt: "desc" },
      });
      return rows.map((t) => ({
        type: "task",
        id: t.id,
        title: t.title,
        summary: `${formatCode("task", t.code)} · ${TASK_STATUS[t.status].label} · prioridade ${TASK_PRIORITY[t.priority].label.toLowerCase()}`,
        date: t.dueDate ? formatDate(t.dueDate) : null,
        url: `/tarefas/${t.id}`,
        score: scoreMatch(t.title, ctx.raw, { codeMatch: code === t.code }),
      }));
    },
  },
  {
    type: "metric",
    permission: "metrics:read",
    async run(db, _actor, ctx) {
      const month = parseMonthQuery(ctx.raw);
      const rows = await db.monthlyMetric.findMany({
        where: {
          ...(month ? { month } : { employee: { searchText: { contains: ctx.q } } }),
          ...(dateRange(ctx) ? { month: { ...dateRange(ctx), ...(month ? { equals: month } : {}) } } : {}),
        },
        include: { employee: { select: { fullName: true, code: true } } },
        take: ctx.take,
        orderBy: { month: "desc" },
      });
      return rows.map((m) => ({
        type: "metric",
        id: m.id,
        title: `${m.employee.fullName} — ${formatMonth(m.month)}`,
        summary: `${m.ticketsHandled} chamados · TMA ${Number(m.avgHandleMinutes).toLocaleString("pt-BR")} min · avaliação ${Number(m.avgRating).toLocaleString("pt-BR")}`,
        date: monthKey(m.month).split("-").reverse().join("/"),
        url: `/desempenho/${m.id}`,
        score: month ? 300 : related(m.employee.fullName, ctx, m.month),
      }));
    },
  },
  {
    type: "feedback",
    permission: "feedbacks:read",
    async run(db, _actor, ctx) {
      const code = codeFor(ctx, "feedback");
      const rows = await db.feedback.findMany({
        where: {
          deletedAt: null,
          OR: [{ searchText: { contains: ctx.q } }, { employee: { searchText: { contains: ctx.q } } }, ...(code !== null ? [{ code }] : [])],
          ...(dateRange(ctx) ? { date: dateRange(ctx) } : {}),
        },
        include: { employee: { select: { fullName: true } } },
        take: ctx.take,
        orderBy: { date: "desc" },
      });
      // Resumo apenas com tipo, situação e colaborador — nunca o conteúdo da conversa
      return rows.map((f) => ({
        type: "feedback",
        id: f.id,
        title: `${FEEDBACK_TYPE[f.type].label} — ${f.employee.fullName}`,
        summary: `${formatCode("feedback", f.code)} · ${FEEDBACK_STATUS[f.status].label}`,
        date: formatDate(f.date),
        url: `/feedbacks/${f.id}`,
        score: code === f.code ? 1000 : related(f.employee.fullName, ctx, f.date),
      }));
    },
  },
  {
    type: "note",
    permission: "notes:read",
    async run(db, _actor, ctx) {
      const rows = await db.employeeNote.findMany({
        where: {
          deletedAt: null,
          OR: [{ searchText: { contains: ctx.q } }, { employee: { searchText: { contains: ctx.q } } }],
          ...(dateRange(ctx) ? { date: dateRange(ctx) } : {}),
        },
        include: { employee: { select: { id: true, fullName: true } } },
        take: ctx.take,
        orderBy: { date: "desc" },
      });
      return rows.map((n) => ({
        type: "note",
        id: n.id,
        title: n.title,
        summary: `${NOTE_CATEGORY[n.category].label} · ${n.employee.fullName}`,
        date: formatDate(n.date),
        url: `/colaboradores/${n.employee.id}?aba=anotacoes#nota-${n.id}`,
        score: Math.max(scoreMatch(n.title, ctx.raw, { recency: n.date }), related(n.employee.fullName, ctx, n.date)),
      }));
    },
  },
  {
    type: "occurrence",
    permission: "attendance:read",
    async run(db, _actor, ctx) {
      const code = codeFor(ctx, "occurrence");
      const rows = await db.attendanceOccurrence.findMany({
        where: {
          deletedAt: null,
          OR: [{ searchText: { contains: ctx.q } }, { employee: { searchText: { contains: ctx.q } } }, ...(code !== null ? [{ code }] : [])],
          ...(dateRange(ctx) ? { date: dateRange(ctx) } : {}),
        },
        // Seleção explícita: observações restritas e anexos nunca são lidos aqui
        select: { id: true, code: true, date: true, startMinute: true, endMinute: true, type: { select: { name: true } }, employee: { select: { fullName: true } } },
        take: ctx.take,
        orderBy: { date: "desc" },
      });
      return rows.map((o) => ({
        type: "occurrence",
        id: o.id,
        title: `${o.type.name} — ${o.employee.fullName}`,
        summary: `${formatCode("occurrence", o.code)}${o.startMinute !== null && o.endMinute !== null ? ` · ${formatTimeRange(o.startMinute, o.endMinute)}` : " · dia inteiro"}`,
        date: formatDate(o.date),
        url: `/frequencia/ocorrencias/${o.id}`,
        score: code === o.code ? 1000 : related(o.employee.fullName, ctx, o.date),
      }));
    },
  },
];

export const MIN_QUERY_LENGTH = 2;

/**
 * Pesquisa global: consulta somente os módulos que o usuário pode acessar e devolve
 * resultados normalizados, agrupados e ordenados por relevância.
 */
export async function globalSearch(db: Db, actor: Actor, rawQuery: string, opts: SearchOptions): Promise<SearchResponse> {
  const raw = rawQuery.trim().slice(0, 100);
  const q = normalizeQuery(raw);
  const code = parseCodeQuery(raw);
  if (q.length < MIN_QUERY_LENGTH && !code) return { query: raw, groups: [], total: 0 };

  const allowed = PROVIDERS.filter((p) => can(actor, p.permission) && (!opts.types?.length || opts.types.includes(p.type)));
  const ctx: Ctx = { q, raw, code, take: opts.limit + 1, from: opts.from, to: opts.to };

  // Falhas isoladas de um provedor não derrubam a pesquisa nos demais módulos.
  const settled = await Promise.allSettled(allowed.map((p) => p.run(db, actor, ctx)));
  const groups: SearchGroup[] = [];
  settled.forEach((r, i) => {
    const type = allowed[i].type;
    if (r.status === "rejected") {
      console.error("[search] falha no provedor", type, r.reason instanceof Error ? r.reason.name : "erro");
      return;
    }
    if (r.value.length === 0) return;
    const sorted = [...r.value].sort((a, b) => b.score - a.score);
    groups.push({ type, label: SEARCH_TYPE_LABEL[type], items: sorted.slice(0, opts.limit), hasMore: sorted.length > opts.limit });
  });
  // Grupos com melhor correspondência primeiro; empate segue a ordem padrão dos módulos
  groups.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0) || SEARCH_TYPES.indexOf(a.type) - SEARCH_TYPES.indexOf(b.type));
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  return { query: raw, groups, total };
}

export function searchableTypes(actor: Actor): SearchType[] {
  return PROVIDERS.filter((p) => can(actor, p.permission)).map((p) => p.type);
}
