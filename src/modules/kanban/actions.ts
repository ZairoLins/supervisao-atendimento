"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { isValidDateKey, parseDateKey } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { isUuid } from "@/lib/page";
import { carryOverPending, createCard, deleteCard, moveCard, updateCard } from "./service";

const PAGE = "/kanban";

function cardId(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) throw new ValidationError("Tarefa inválida.");
  return id;
}

export async function createCardAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createCard(db, actor, formToObject(fd));
    return { message: "Tarefa adicionada.", revalidate: [PAGE, "/"] };
  });
}

export async function updateCardAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateCard(db, actor, cardId(fd), formToObject(fd));
    return { message: "Tarefa salva.", revalidate: [PAGE, "/"] };
  });
}

export async function moveCardAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await moveCard(db, actor, cardId(fd), formToObject(fd));
    return { revalidate: [PAGE, "/"] };
  });
}

export async function deleteCardAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteCard(db, actor, cardId(fd));
    return { message: "Tarefa excluída.", revalidate: [PAGE, "/"] };
  });
}

export async function carryOverAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const week = String(fd.get("week") ?? "");
    if (!isValidDateKey(week)) throw new ValidationError("Semana inválida.");
    const n = await carryOverPending(db, actor, parseDateKey(week));
    return { message: n ? `${n} pendência(s) trazida(s) para esta semana.` : "Nenhuma pendência de semanas anteriores.", revalidate: [PAGE, "/"] };
  });
}
