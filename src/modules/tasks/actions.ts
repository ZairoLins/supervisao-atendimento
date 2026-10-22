"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import { createTask, deleteTask, setTaskStatus, updateTask } from "./service";

export async function createTaskAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const t = await createTask(db, actor, formToObject(fd));
    return { redirectTo: `/tarefas/${t.id}?salvo=1`, revalidate: ["/tarefas", "/"] };
  });
}

export async function updateTaskAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateTask(db, actor, id, formToObject(fd));
    return { redirectTo: `/tarefas/${id}?salvo=1`, revalidate: ["/tarefas", "/"] };
  });
}

export async function setTaskStatusAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const s = String(fd.get("status"));
    if (!["PENDING", "IN_PROGRESS", "DONE", "CANCELED"].includes(s)) throw new ValidationError("Status inválido.");
    await setTaskStatus(db, actor, id, s as "PENDING");
    return { message: "Status atualizado.", revalidate: ["/tarefas", "/"] };
  });
}

export async function deleteTaskAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteTask(db, actor, id);
    return { redirectTo: "/tarefas", revalidate: ["/tarefas", "/"] };
  });
}
