"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import {
  addAgendaItem,
  addDecision,
  createMeeting,
  createSeries,
  createTemplate,
  deleteMeeting,
  deleteTemplate,
  generateSeriesMeetings,
  moveAgendaItem,
  removeAgendaItem,
  removeDecision,
  saveMinutes,
  setAttendance,
  templateFromMeeting,
  toggleAgendaDiscussed,
  toggleSeries,
  updateAgendaItem,
  updateMeeting,
} from "./service";

const path = (id: string) => `/reunioes/${id}`;

export async function createMeetingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const m = await createMeeting(db, actor, formToObject(fd, ["participantIds"]));
    return { redirectTo: `${path(m.id)}?salvo=1`, revalidate: ["/reunioes", "/"] };
  });
}

export async function updateMeetingAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateMeeting(db, actor, id, formToObject(fd, ["participantIds"]));
    return { redirectTo: `${path(id)}?salvo=1`, revalidate: ["/reunioes", "/"] };
  });
}

export async function deleteMeetingAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteMeeting(db, actor, id);
    return { redirectTo: "/reunioes", revalidate: ["/reunioes", "/"] };
  });
}

export async function saveMinutesAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await saveMinutes(db, actor, id, formToObject(fd));
    return { message: "Ata salva.", revalidate: [path(id)] };
  });
}

export async function addAgendaItemAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await addAgendaItem(db, actor, meetingId, formToObject(fd));
    return { message: "Item adicionado à pauta.", revalidate: [path(meetingId)] };
  });
}

export async function updateAgendaItemAction(itemId: string, meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await updateAgendaItem(db, actor, itemId, formToObject(fd));
    return { message: "Item atualizado.", revalidate: [path(meetingId)] };
  });
}

export async function agendaCommandAction(itemId: string, meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const cmd = fd.get("cmd");
    if (cmd === "up" || cmd === "down") await moveAgendaItem(db, actor, itemId, cmd);
    else if (cmd === "toggle") await toggleAgendaDiscussed(db, actor, itemId);
    else if (cmd === "remove") await removeAgendaItem(db, actor, itemId);
    else throw new ValidationError("Comando inválido.");
    return { message: "Pauta atualizada.", revalidate: [path(meetingId)] };
  });
}

export async function addDecisionAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await addDecision(db, actor, meetingId, formToObject(fd));
    return { message: "Decisão registrada.", revalidate: [path(meetingId)] };
  });
}

export async function removeDecisionAction(decisionId: string, meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await removeDecision(db, actor, decisionId);
    return { message: "Decisão removida.", revalidate: [path(meetingId)] };
  });
}

export async function setAttendanceAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await setAttendance(db, actor, meetingId, formToObject(fd, ["attended"]));
    return { message: "Presenças registradas.", revalidate: [path(meetingId)] };
  });
}

export async function templateFromMeetingAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await templateFromMeeting(db, actor, meetingId, formToObject(fd));
    return { message: "Pauta salva como modelo.", revalidate: ["/reunioes/modelos"] };
  });
}

export async function createTemplateAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createTemplate(db, actor, formToObject(fd));
    return { message: "Modelo criado.", revalidate: ["/reunioes/modelos"] };
  });
}

export async function deleteTemplateAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await deleteTemplate(db, actor, id);
    return { message: "Modelo removido.", revalidate: ["/reunioes/modelos"] };
  });
}

export async function createSeriesAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await createSeries(db, actor, formToObject(fd, ["participantIds"]));
    return { message: "Série semanal criada e reuniões geradas.", revalidate: ["/reunioes", "/"] };
  });
}

export async function generateSeriesAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const n = await generateSeriesMeetings(db, actor, id, 4);
    return { message: n ? `${n} reunião(ões) gerada(s).` : "As próximas semanas já estavam geradas.", revalidate: ["/reunioes", "/"] };
  });
}

export async function toggleSeriesAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await toggleSeries(db, actor, id);
    return { message: "Série atualizada.", revalidate: ["/reunioes/modelos"] };
  });
}
