import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { FeedbackStatus, FeedbackType } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { FEEDBACK_TYPE, NOTE_CATEGORY } from "@/lib/labels";
import { assertCan, type Actor } from "@/lib/permissions";
import { buildSearchText, formatCode, normalizeQuery } from "@/lib/text";
import { dateField, optionalDateField, optionalText, PAGE_SIZE, requiredText, uuidField } from "@/lib/validation";

// ───────────── Feedbacks individuais ─────────────

const feedbackSchema = z.object({
  employeeId: uuidField("o colaborador"),
  date: dateField(),
  type: z.enum(["RECOGNITION", "DEVELOPMENT", "CORRECTIVE", "ALIGNMENT", "ONE_ON_ONE"], { error: "Selecione o tipo." }),
  context: requiredText("o contexto profissional", 2000),
  positives: optionalText(4000),
  improvements: optionalText(4000),
  agreedActions: optionalText(4000),
  followUpDate: optionalDateField(),
  status: z.enum(["OPEN", "FOLLOW_UP", "CLOSED"]).default("OPEN"),
  reviewDate: optionalDateField(),
});

function feedbackSearchText(f: { code: number; type: FeedbackType; context: string }) {
  // Indexa identificador, tipo e contexto — não os pontos detalhados da conversa.
  return buildSearchText(formatCode("feedback", f.code), FEEDBACK_TYPE[f.type].label, f.context.slice(0, 500));
}

function nullify<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v])) as { [K in keyof T]: Exclude<T[K], undefined> | null };
}

export async function createFeedback(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "feedbacks:write");
  const v = feedbackSchema.parse(raw);
  const employee = await db.employee.findUnique({ where: { id: v.employeeId } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  return db.$transaction(async (tx) => {
    const created = await tx.feedback.create({ data: { ...nullify(v), employeeId: v.employeeId, date: v.date, type: v.type, context: v.context, status: v.status } });
    const fb = await tx.feedback.update({ where: { id: created.id }, data: { searchText: feedbackSearchText(created) } });
    await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "Feedback", entityId: fb.id, summary: `Feedback ${formatCode("feedback", fb.code)} registrado para ${formatCode("employee", employee.code)}` });
    return fb;
  });
}

export async function updateFeedback(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "feedbacks:write");
  const v = feedbackSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.feedback.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Feedback não encontrado.");
    const fb = await tx.feedback.update({
      where: { id },
      data: { ...nullify(v), employeeId: v.employeeId, date: v.date, type: v.type, context: v.context, status: v.status, searchText: feedbackSearchText({ ...before, ...v }) },
    });
    // A auditoria registra quais campos mudaram, sem copiar o conteúdo da conversa.
    const changed = Object.keys(v).filter((k) => JSON.stringify((before as Record<string, unknown>)[k] ?? null) !== JSON.stringify((fb as Record<string, unknown>)[k] ?? null));
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "Feedback", entityId: id, summary: `Feedback ${formatCode("feedback", fb.code)} atualizado (${changed.join(", ") || "sem alterações"})` });
    return fb;
  });
}

export async function deleteFeedback(db: Db, actor: Actor, id: string) {
  assertCan(actor, "feedbacks:write");
  return db.$transaction(async (tx) => {
    const fb = await tx.feedback.findUnique({ where: { id } });
    if (!fb || fb.deletedAt) throw new NotFoundError("Feedback não encontrado.");
    await tx.feedback.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "Feedback", entityId: id, summary: `Feedback ${formatCode("feedback", fb.code)} excluído` });
  });
}

export async function getFeedback(db: Db, actor: Actor, id: string) {
  assertCan(actor, "feedbacks:read");
  const fb = await db.feedback.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullName: true, code: true } }, tasks: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!fb || fb.deletedAt) throw new NotFoundError("Feedback não encontrado.");
  return fb;
}

export async function listFeedbacks(
  db: Db,
  actor: Actor,
  f: { employeeId?: string; type?: FeedbackType; status?: FeedbackStatus; from?: Date; to?: Date; q?: string; followUpDue?: Date; page?: number },
) {
  assertCan(actor, "feedbacks:read");
  const where: Prisma.FeedbackWhereInput = { deletedAt: null };
  if (f.employeeId) where.employeeId = f.employeeId;
  if (f.type) where.type = f.type;
  if (f.status) where.status = f.status;
  if (f.from || f.to) where.date = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  if (f.followUpDue) Object.assign(where, { followUpDate: { lte: f.followUpDue }, status: { not: "CLOSED" } });
  const q = normalizeQuery(f.q);
  if (q) where.OR = [{ searchText: { contains: q } }, { employee: { searchText: { contains: q } } }];
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.feedback.count({ where }),
    db.feedback.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, code: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

// ───────────── Anotações profissionais ─────────────

const noteSchema = z.object({
  employeeId: uuidField("o colaborador"),
  date: dateField(),
  category: z.enum(["OBSERVATION", "RECOGNITION", "ALIGNMENT", "DEVELOPMENT", "OTHER"]),
  title: requiredText("o título", 160),
  content: requiredText("o conteúdo", 4000),
});

export async function createNote(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "notes:write");
  const v = noteSchema.parse(raw);
  const employee = await db.employee.findUnique({ where: { id: v.employeeId } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  return db.$transaction(async (tx) => {
    const n = await tx.employeeNote.create({ data: { ...v, searchText: buildSearchText(NOTE_CATEGORY[v.category].label, v.title, v.content.slice(0, 500)) } });
    await audit(tx, { actorId: actor.id, action: "CREATE", entityType: "EmployeeNote", entityId: n.id, summary: `Anotação registrada para ${formatCode("employee", employee.code)}` });
    return n;
  });
}

export async function updateNote(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "notes:write");
  const v = noteSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.employeeNote.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw new NotFoundError("Anotação não encontrada.");
    const n = await tx.employeeNote.update({ where: { id }, data: { ...v, searchText: buildSearchText(NOTE_CATEGORY[v.category].label, v.title, v.content.slice(0, 500)) } });
    await audit(tx, { actorId: actor.id, action: "UPDATE", entityType: "EmployeeNote", entityId: id, summary: "Anotação atualizada" });
    return n;
  });
}

export async function deleteNote(db: Db, actor: Actor, id: string) {
  assertCan(actor, "notes:write");
  return db.$transaction(async (tx) => {
    const n = await tx.employeeNote.findUnique({ where: { id } });
    if (!n || n.deletedAt) throw new NotFoundError("Anotação não encontrada.");
    await tx.employeeNote.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.id, action: "DELETE", entityType: "EmployeeNote", entityId: id, summary: "Anotação excluída" });
  });
}

export async function getNote(db: Db, actor: Actor, id: string) {
  assertCan(actor, "notes:read");
  const n = await db.employeeNote.findUnique({ where: { id }, include: { employee: { select: { id: true, fullName: true } } } });
  if (!n || n.deletedAt) throw new NotFoundError("Anotação não encontrada.");
  return n;
}

export async function listNotes(db: Db, actor: Actor, employeeId: string) {
  assertCan(actor, "notes:read");
  return db.employeeNote.findMany({ where: { employeeId, deletedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
}
