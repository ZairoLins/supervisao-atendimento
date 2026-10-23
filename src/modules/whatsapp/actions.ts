"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { isValidDateKey, parseDateKey } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { isUuid } from "@/lib/page";
import { defaultSender } from "./client";
import {
  saveNotificationSettings,
  sendMeetingAgendaToManager,
  sendMeetingReminderToGroup,
  sendMonthlyMetricsToManager,
  sendOccurrencesToManager,
  sendTestMessage,
} from "./service";

const PAGE = "/whatsapp";

export async function saveNotificationSettingsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await saveNotificationSettings(db, actor, formToObject(fd));
    return { message: "Destinatários salvos.", revalidate: [PAGE] };
  });
}

export async function sendTestAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const target = fd.get("target") === "GROUP" ? "GROUP" : "MANAGER";
    const r = await sendTestMessage(db, actor, target, defaultSender());
    return { message: `Mensagem de teste enviada para ${r.destinationLabel}.`, revalidate: [PAGE] };
  });
}

export async function sendOccurrencesAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const raw = String(fd.get("folha") ?? "");
    if (raw && !isValidDateKey(raw)) throw new ValidationError("Data inválida.", { folha: "Data inválida." });
    const r = await sendOccurrencesToManager(db, actor, { folha: raw ? parseDateKey(raw) : undefined }, defaultSender());
    return { message: `Ocorrências enviadas para ${r.destinationLabel} (${r.summary}).`, revalidate: [PAGE] };
  });
}

export async function sendMonthlyMetricsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const raw = String(fd.get("mes") ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new ValidationError("Escolha o mês.", { mes: "Mês inválido." });
    const r = await sendMonthlyMetricsToManager(db, actor, { month: parseDateKey(`${raw}-01`) }, defaultSender());
    return { message: `Relatório mensal enviado para ${r.destinationLabel}.`, revalidate: [PAGE] };
  });
}

export async function sendMeetingAgendaAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const r = await sendMeetingAgendaToManager(db, actor, checkId(meetingId), defaultSender());
    return { message: `Pauta enviada para ${r.destinationLabel}.`, revalidate: [`/reunioes/${meetingId}`, PAGE] };
  });
}

export async function sendMeetingReminderAction(meetingId: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const r = await sendMeetingReminderToGroup(db, actor, checkId(meetingId), defaultSender());
    return { message: `Aviso enviado para ${r.destinationLabel}.`, revalidate: [`/reunioes/${meetingId}`, PAGE] };
  });
}

function checkId(id: string) {
  if (!isUuid(id)) throw new ValidationError("Reunião inválida.");
  return id;
}
