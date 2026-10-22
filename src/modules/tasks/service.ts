import { z } from "zod";
import type { Db, Tx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { assertCan, can, type Actor } from "@/lib/permissions";
import { buildSearchText, formatCode, normalizeQuery } from "@/lib/text";
import { optionalDateField, optionalText, optionalUuid, PAGE_SIZE, requiredText } from "@/lib/validation";

const STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "CANCELED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const taskSchema = z.object({
  title: requiredText("o título", 200),
  description: optionalText(4000),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  status: z.enum(STATUSES).default("PENDING"),
  dueDate: optionalDateField(),
  // Responsável: "user:<id>" (supervisor/usuário) ou "employee:<id>" (colaborador)
  assignee: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^(user|employee):[0-9a-f-]{36}$/, "Responsável inválido.").optional()),
  employeeId: optionalUuid(),
  meetingId: optionalUuid(),
  feedbackId: optionalUuid(),
});

function parseAssignee(value?: string) {
  if (!value) return { assigneeUserId: null, assigneeEmployeeId: null };
  const [kind, id] = value.split(":");
  return kind === "user" ? { assigneeUserId: id, assigneeEmployeeId: null } : { assigneeUserId: null, assigneeEmployeeId: id };
}

function taskSearchText(t: { code: number; title: string; description: string | null }) {
  return buildSearchText(formatCode("task", t.code), t.title, t.description?.slice(0, 1000));
}

/** Garante que os vínculos existem e que o usuário pode vê-los (ex.: feedback). */
async function validateLinks(tx: Tx, actor: Actor, v: { employeeId?: string; meetingId?: string; feedbackId?: string; assignee?: string }) {
  if (v.employeeId && !(await tx.employee.findUnique({ where: { id: v.employeeId }, select: { id: true } }))) {
    throw new ValidationError("Colaborador relacionado inválido.", { employeeId: "Não encontrado." });
  }
  if (v.meetingId && !(await tx.meeting.findFirst({ where: { id: v.meetingId, deletedAt: null }, select: { id: true } }))) {
    throw new ValidationError("Reunião relacionada inválida.", { meetingId: "Não encontrada." });
  }
  if (v.feedbackId) {
    if (!can(actor, "feedbacks:read")) throw new ValidationError("Sem permissão para vincular feedbacks.", { feedbackId: "Sem permissão." });
    if (!(await tx.feedback.findFirst({ where: { id: v.feedbackId, deletedAt: null }, select: { id: true } }))) {
      throw new ValidationError("Feedback relacionado inválido.", { feedbackId: "Não encontrado." });
    }
  }
  const a = parseAssignee(v.assignee);
  if (a.assigneeUserId && !(await tx.user.findUnique({ where: { id: a.assigneeUserId }, select: { id: true } }))) {
    throw new ValidationError("Responsável inválido.", { assignee: "Não encontrado." });
  }
  if (a.assigneeEmployeeId && !(await tx.employee.findUnique({ where: { id: a.assigneeEmployeeId }, select: { id: true } }))) {
    throw new ValidationError("Responsável inválido.", { assignee: "Não encontrado." });
  }
  return a;
}

export async function createTask(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "tasks:write");
  const v = taskSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const assignee = await validateLinks(tx, actor, v);
    const created = await tx.task.create({
      data: {
        title: v.title,
        description: v.description ?? null,
        priority: v.priority,
        status: v.status,
        dueDate: v.dueDate ?? null,
        completedAt: v.status === "DONE" ? new Date() : null,
        employeeId: v.employeeId ?? null,
        meetingId: v.meetingId ?? null,
        feedbackId: v.feedbackId ?? null,
        ...assignee,
      },
    });
    const task = await tx.task.update({ where: { id: created.id }, data: { searchText: taskSearchText(created) } });
    await tx.taskEvent.create({ data: { taskId: task.id, userId: actor.id, field: "created", toValue: TASK_STATUS[task.status].label } });
    await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "Task", entityId: task.id, summary: `Tarefa ${formatCode("task", task.code)} criada`, after: task });
    return task;
  });
}

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  priority: "Prioridade",
  status: "Status",
  dueDate: "Prazo",
  assigneeUserId: "Responsável",
  assigneeEmployeeId: "Responsável",
  employeeId: "Colaborador relacionado",
  meetingId: "Reunião relacionada",
  feedbackId: "Feedback relacionado",
};

function display(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field === "status") return TASK_STATUS[value as TaskStatus].label;
  if (field === "priority") return TASK_PRIORITY[value as TaskPriority].label;
  if (value instanceof Date) return formatDate(value);
  if (field === "description") return String(value).slice(0, 200);
  return String(value);
}

/** Atualiza a tarefa registrando cada campo alterado no histórico (TaskEvent). */
export async function updateTask(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "tasks:write");
  const v = taskSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.task.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Tarefa não encontrada.");
    const assignee = await validateLinks(tx, actor, v);
    // Vínculo de feedback é preservado quando o usuário não pode ver feedbacks
    const feedbackId = can(actor, "feedbacks:read") ? (v.feedbackId ?? null) : before.feedbackId;
    const next = {
      title: v.title,
      description: v.description ?? null,
      priority: v.priority,
      status: v.status,
      dueDate: v.dueDate ?? null,
      employeeId: v.employeeId ?? null,
      meetingId: v.meetingId ?? null,
      feedbackId,
      ...assignee,
    };
    const completedAt = v.status === "DONE" ? (before.completedAt ?? new Date()) : null;
    const task = await tx.task.update({
      where: { id },
      data: { ...next, completedAt, searchText: taskSearchText({ code: before.code, title: next.title, description: next.description }) },
    });
    for (const [field, value] of Object.entries(next)) {
      const prev = (before as Record<string, unknown>)[field];
      const a = prev instanceof Date ? prev.getTime() : prev;
      const b = value instanceof Date ? value.getTime() : value;
      if (a !== b) {
        await tx.taskEvent.create({ data: { taskId: id, userId: actor.id, field: FIELD_LABELS[field] ?? field, fromValue: display(field, prev), toValue: display(field, value) } });
      }
    }
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "Task", entityId: id, summary: `Tarefa ${formatCode("task", task.code)} atualizada`, before, after: task });
    return task;
  });
}

export async function setTaskStatus(db: Db, actor: Actor, id: string, status: TaskStatus) {
  assertCan(actor, "tasks:write");
  return db.$transaction(async (tx) => {
    const before = await tx.task.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Tarefa não encontrada.");
    if (before.status === status) return before;
    const task = await tx.task.update({ where: { id }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    await tx.taskEvent.create({ data: { taskId: id, userId: actor.id, field: "Status", fromValue: display("status", before.status), toValue: display("status", status) } });
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "Task", entityId: id, summary: `Status da tarefa ${formatCode("task", task.code)}: ${TASK_STATUS[status].label}`, before, after: task });
    return task;
  });
}

export async function deleteTask(db: Db, actor: Actor, id: string) {
  assertCan(actor, "tasks:write");
  return db.$transaction(async (tx) => {
    const t = await tx.task.findUnique({ where: { id } });
    if (!t || t.deletedAt) throw new NotFoundError("Tarefa não encontrada.");
    await tx.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "Task", entityId: id, summary: `Tarefa ${formatCode("task", t.code)} excluída` });
  });
}

export async function getTask(db: Db, actor: Actor, id: string) {
  assertCan(actor, "tasks:read");
  const t = await db.task.findUnique({
    where: { id },
    include: {
      assigneeUser: { select: { id: true, name: true } },
      assigneeEmployee: { select: { id: true, fullName: true } },
      employee: { select: { id: true, fullName: true, code: true } },
      meeting: { select: { id: true, title: true, date: true, code: true, deletedAt: true } },
      feedback: { select: { id: true, code: true, date: true, deletedAt: true } },
      events: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!t || t.deletedAt) throw new NotFoundError("Tarefa não encontrada.");
  // Não revela vínculo com feedback para quem não tem acesso a feedbacks
  return can(actor, "feedbacks:read") ? t : { ...t, feedback: null, feedbackId: null };
}

export type TaskFilters = {
  q?: string;
  status?: TaskStatus | "OPEN";
  priority?: TaskPriority;
  assignee?: string;
  origin?: "meeting" | "employee" | "feedback" | "manual";
  due?: "overdue" | "week" | "none";
  employeeId?: string;
  meetingId?: string;
  page?: number;
  sort?: string;
  dir?: "asc" | "desc";
};

export async function listTasks(db: Db, actor: Actor, f: TaskFilters, today: Date) {
  assertCan(actor, "tasks:read");
  const where: Prisma.TaskWhereInput = { deletedAt: null };
  if (f.status === "OPEN") where.status = { in: ["PENDING", "IN_PROGRESS"] };
  else if (f.status) where.status = f.status;
  if (f.priority) where.priority = f.priority;
  if (f.assignee) Object.assign(where, parseAssignee(f.assignee));
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.meetingId) where.meetingId = f.meetingId;
  if (f.origin === "meeting") where.meetingId = { not: null };
  if (f.origin === "employee") where.employeeId = { not: null };
  if (f.origin === "feedback" && can(actor, "feedbacks:read")) where.feedbackId = { not: null };
  if (f.origin === "manual") Object.assign(where, { meetingId: null, employeeId: null, feedbackId: null });
  if (f.due === "overdue") Object.assign(where, { dueDate: { lt: today }, status: { in: ["PENDING", "IN_PROGRESS"] } });
  if (f.due === "week") where.dueDate = { gte: today, lte: new Date(today.getTime() + 7 * 86_400_000) };
  if (f.due === "none") where.dueDate = null;
  const q = normalizeQuery(f.q);
  if (q) where.searchText = { contains: q };
  const dir = f.dir ?? "asc";
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    f.sort === "priority"
      ? [{ priority: dir === "asc" ? "desc" : "asc" }]
      : f.sort === "created"
        ? [{ createdAt: dir }]
        : f.sort === "title"
          ? [{ title: dir }]
          : [{ dueDate: { sort: dir, nulls: "last" } }, { priority: "desc" }];
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      include: {
        assigneeUser: { select: { name: true } },
        assigneeEmployee: { select: { fullName: true } },
        employee: { select: { id: true, fullName: true } },
        meeting: { select: { id: true, title: true } },
      },
      orderBy: [...orderBy, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const visible = can(actor, "feedbacks:read") ? items : items.map((t) => ({ ...t, feedbackId: null }));
  return { total, items: visible, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

export async function assigneeOptions(db: Db, actor: Actor) {
  assertCan(actor, "tasks:read");
  const [users, employees] = await Promise.all([
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    can(actor, "employees:read")
      ? db.employee.findMany({ where: { status: { not: "INACTIVE" } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
      : Promise.resolve([]),
  ]);
  return [
    ...users.map((u) => ({ value: `user:${u.id}`, label: u.name, group: "Usuários do sistema" })),
    ...employees.map((e) => ({ value: `employee:${e.id}`, label: e.fullName, group: "Colaboradores" })),
  ];
}

export function isOverdue(task: { dueDate: Date | null; status: TaskStatus }, today: Date): boolean {
  return Boolean(task.dueDate && task.dueDate.getTime() < today.getTime() && (task.status === "PENDING" || task.status === "IN_PROGRESS"));
}
