"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import { assignSchedule, createAdjustment, createSchedule, deleteAssignment, endAssignment, revokeAdjustment, updateSchedule } from "./schedules";
import {
  addAttachment,
  createOccurrence,
  createOccurrenceType,
  deleteOccurrence,
  removeAttachment,
  setReviewStatus,
  toggleOccurrenceType,
  updateOccurrence,
} from "./occurrences";

export async function createOccurrenceAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const o = await createOccurrence(db, actor, formToObject(fd));
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
      await addAttachment(db, actor, o.id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    return { redirectTo: `/frequencia/ocorrencias/${o.id}?salvo=1`, revalidate: ["/frequencia", "/"] };
  });
}

export async function updateOccurrenceAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateOccurrence(db, actor, id, formToObject(fd));
    return { redirectTo: `/frequencia/ocorrencias/${id}?salvo=1`, revalidate: ["/frequencia", "/"] };
  });
}

export async function reviewOccurrenceAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const status = String(fd.get("status"));
    if (status !== "PENDING" && status !== "CONFIRMED" && status !== "DISREGARDED") throw new ValidationError("Situação inválida.");
    await setReviewStatus(db, actor, id, status);
    return { message: "Situação de conferência atualizada.", revalidate: ["/frequencia", "/"] };
  });
}

export async function deleteOccurrenceAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteOccurrence(db, actor, id, formToObject(fd));
    return { redirectTo: "/frequencia?excluida=1", revalidate: ["/frequencia", "/"] };
  });
}

export async function uploadAttachmentAction(occurrenceId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Selecione um arquivo.", { file: "Obrigatório." });
    await addAttachment(db, actor, occurrenceId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return { message: "Anexo enviado para o armazenamento privado.", revalidate: [`/frequencia/ocorrencias/${occurrenceId}`] };
  });
}

export async function removeAttachmentAction(id: string, occurrenceId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await removeAttachment(db, actor, id);
    return { message: "Anexo removido.", revalidate: [`/frequencia/ocorrencias/${occurrenceId}`] };
  });
}

export async function createScheduleAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createSchedule(db, actor, formToObject(fd, ["weekdays"]));
    return { redirectTo: "/frequencia/jornadas?salvo=1", revalidate: ["/frequencia/jornadas"] };
  });
}

export async function updateScheduleAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateSchedule(db, actor, id, formToObject(fd, ["weekdays"]));
    return { redirectTo: "/frequencia/jornadas?salvo=1", revalidate: ["/frequencia"] };
  });
}

export async function assignScheduleAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const a = await assignSchedule(db, actor, formToObject(fd));
    return { message: "Jornada atribuída. A vigência anterior foi encerrada e mantida no histórico.", revalidate: ["/frequencia", `/colaboradores/${a.employeeId}`] };
  });
}

export async function endAssignmentAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await endAssignment(db, actor, id, formToObject(fd));
    return { message: "Vigência encerrada.", revalidate: ["/frequencia"] };
  });
}

export async function deleteAssignmentAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const r = await deleteAssignment(db, actor, id);
    return { message: r.reopened ? "Vigência excluída. A jornada anterior voltou a valer." : "Vigência excluída.", revalidate: ["/frequencia", `/colaboradores/${r.employeeId}`] };
  });
}

export async function createAdjustmentAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createAdjustment(db, actor, formToObject(fd));
    return { message: "Ajuste registrado. A escala prevista foi preservada.", revalidate: ["/frequencia"] };
  });
}

export async function revokeAdjustmentAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await revokeAdjustment(db, actor, id, formToObject(fd));
    return { message: "Ajuste revogado.", revalidate: ["/frequencia"] };
  });
}

export async function createOccurrenceTypeAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createOccurrenceType(db, actor, formToObject(fd));
    return { message: "Tipo de ocorrência criado.", revalidate: ["/configuracoes", "/frequencia"] };
  });
}

export async function toggleOccurrenceTypeAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await toggleOccurrenceType(db, actor, id);
    return { message: "Tipo atualizado.", revalidate: ["/configuracoes"] };
  });
}
