"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { createEmployee, inactivateEmployee, reactivateEmployee, updateEmployee } from "./service";
import { createNote, deleteNote, updateNote } from "@/modules/feedbacks/service";

export async function createEmployeeAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const e = await createEmployee(db, actor, formToObject(fd));
    return { redirectTo: `/colaboradores/${e.id}?salvo=1`, revalidate: ["/colaboradores"] };
  });
}

export async function updateEmployeeAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateEmployee(db, actor, id, formToObject(fd));
    return { redirectTo: `/colaboradores/${id}?salvo=1`, revalidate: ["/colaboradores"] };
  });
}

export async function inactivateEmployeeAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await inactivateEmployee(db, actor, id, formToObject(fd));
    return { message: "Colaborador inativado. Os históricos foram preservados.", revalidate: ["/colaboradores"] };
  });
}

export async function reactivateEmployeeAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await reactivateEmployee(db, actor, id);
    return { message: "Colaborador reativado.", revalidate: ["/colaboradores"] };
  });
}

export async function createNoteAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const n = await createNote(db, actor, formToObject(fd));
    return { message: "Anotação registrada.", revalidate: [`/colaboradores/${n.employeeId}`] };
  });
}

export async function updateNoteAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const n = await updateNote(db, actor, id, formToObject(fd));
    return { redirectTo: `/colaboradores/${n.employeeId}?aba=anotacoes`, revalidate: [`/colaboradores/${n.employeeId}`] };
  });
}

export async function deleteNoteAction(id: string, employeeId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteNote(db, actor, id);
    return { message: "Anotação excluída.", revalidate: [`/colaboradores/${employeeId}`] };
  });
}
