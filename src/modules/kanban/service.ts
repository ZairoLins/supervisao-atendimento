import { z } from "zod";
import type { Db, Tx } from "@/lib/db";
import type { KanbanColumn } from "@/generated/prisma/enums";
import { addDays, dayNumber } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { dateField, optionalDateField, optionalText, requiredText } from "@/lib/validation";
import { weekStartOf } from "@/modules/metrics/service";

/**
 * Quadro Kanban das tarefas da semana (pessoal da supervisão): A fazer → Fazendo → Feito.
 * Cada cartão pertence a uma semana (segunda-feira); pendências podem ser trazidas para a
 * semana seguinte.
 */

export const KANBAN_COLUMNS = ["TODO", "DOING", "DONE"] as const;

const columnField = z.enum(KANBAN_COLUMNS, { error: "Coluna inválida." });
const priorityField = z.enum(["LOW", "NORMAL", "HIGH"], { error: "Prioridade inválida." }).default("NORMAL");

const cardSchema = z.object({
  title: requiredText("a tarefa", 200),
  description: optionalText(4000),
  priority: priorityField,
  dueDate: optionalDateField(),
});

async function nextPosition(tx: Tx | Db, weekStart: Date, column: KanbanColumn) {
  const last = await tx.kanbanCard.findFirst({ where: { weekStart, column }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? -1) + 1;
}

export async function listBoard(db: Db, actor: Actor, week: Date) {
  assertCan(actor, "kanban:manage");
  const weekStart = weekStartOf(week);
  const [cards, pendingBefore] = await Promise.all([
    db.kanbanCard.findMany({ where: { weekStart }, orderBy: [{ column: "asc" }, { position: "asc" }] }),
    db.kanbanCard.count({ where: { weekStart: { lt: weekStart }, column: { not: "DONE" } } }),
  ]);
  return { weekStart, cards, pendingBefore };
}

export async function createCard(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "kanban:manage");
  const v = cardSchema.extend({ week: dateField("a semana"), column: columnField.default("TODO") }).parse(raw);
  const weekStart = weekStartOf(v.week);
  return db.$transaction(async (tx) =>
    tx.kanbanCard.create({
      data: {
        title: v.title,
        description: v.description ?? null,
        priority: v.priority,
        dueDate: v.dueDate ?? null,
        column: v.column,
        weekStart,
        position: await nextPosition(tx, weekStart, v.column),
        completedAt: v.column === "DONE" ? new Date() : null,
        createdById: actor.id,
      },
    }),
  );
}

export async function updateCard(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "kanban:manage");
  const v = cardSchema.parse(raw);
  const card = await db.kanbanCard.findUnique({ where: { id } });
  if (!card) throw new NotFoundError("Tarefa não encontrada.");
  return db.kanbanCard.update({ where: { id }, data: { title: v.title, description: v.description ?? null, priority: v.priority, dueDate: v.dueDate ?? null } });
}

/** Move o cartão para a coluna e posição indicadas, renumerando as duas colunas envolvidas. */
export async function moveCard(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "kanban:manage");
  const v = z.object({ column: columnField, index: z.coerce.number().int().min(0).max(10_000) }).parse(raw);
  return db.$transaction(async (tx) => {
    const card = await tx.kanbanCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundError("Tarefa não encontrada.");
    const target = await tx.kanbanCard.findMany({ where: { weekStart: card.weekStart, column: v.column, id: { not: id } }, orderBy: { position: "asc" } });
    const ordered = [...target];
    ordered.splice(Math.min(v.index, ordered.length), 0, card);
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      const data: { position: number; column?: KanbanColumn; completedAt?: Date | null } = { position: i };
      if (c.id === id && card.column !== v.column) {
        data.column = v.column;
        data.completedAt = v.column === "DONE" ? new Date() : null;
      }
      if (c.position !== i || data.column) await tx.kanbanCard.update({ where: { id: c.id }, data });
    }
    if (card.column !== v.column) {
      const source = await tx.kanbanCard.findMany({ where: { weekStart: card.weekStart, column: card.column }, orderBy: { position: "asc" } });
      for (let i = 0; i < source.length; i++) if (source[i].position !== i) await tx.kanbanCard.update({ where: { id: source[i].id }, data: { position: i } });
    }
  });
}

export async function deleteCard(db: Db, actor: Actor, id: string) {
  assertCan(actor, "kanban:manage");
  return db.$transaction(async (tx) => {
    const card = await tx.kanbanCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundError("Tarefa não encontrada.");
    await tx.kanbanCard.delete({ where: { id } });
    const rest = await tx.kanbanCard.findMany({ where: { weekStart: card.weekStart, column: card.column }, orderBy: { position: "asc" } });
    for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await tx.kanbanCard.update({ where: { id: rest[i].id }, data: { position: i } });
  });
}

/** Traz para a semana as tarefas não concluídas de semanas anteriores (mantendo a coluna). */
export async function carryOverPending(db: Db, actor: Actor, week: Date) {
  assertCan(actor, "kanban:manage");
  const weekStart = weekStartOf(week);
  return db.$transaction(async (tx) => {
    const pending = await tx.kanbanCard.findMany({
      where: { weekStart: { lt: weekStart }, column: { not: "DONE" } },
      orderBy: [{ weekStart: "asc" }, { position: "asc" }],
    });
    for (const column of ["TODO", "DOING"] as const) {
      let pos = await nextPosition(tx, weekStart, column);
      for (const c of pending.filter((p) => p.column === column)) await tx.kanbanCard.update({ where: { id: c.id }, data: { weekStart, position: pos++ } });
    }
    return pending.length;
  });
}

/** Resumo para o dashboard: tarefas da semana atual por coluna e atrasadas. */
export async function weekSummary(db: Db, actor: Actor, today: Date) {
  assertCan(actor, "kanban:manage");
  const weekStart = weekStartOf(today);
  const cards = await db.kanbanCard.findMany({ where: { weekStart }, select: { column: true, dueDate: true } });
  return {
    todo: cards.filter((c) => c.column === "TODO").length,
    doing: cards.filter((c) => c.column === "DOING").length,
    done: cards.filter((c) => c.column === "DONE").length,
    overdue: cards.filter((c) => c.column !== "DONE" && c.dueDate && dayNumber(c.dueDate) < dayNumber(today)).length,
    weekEnd: addDays(weekStart, 6),
  };
}
