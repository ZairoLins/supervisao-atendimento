import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseDateKey } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { createMeeting, saveAgenda } from "@/modules/meetings/service";
import { createMetric } from "@/modules/metrics/service";
import { createOccurrence } from "@/modules/attendance/occurrences";
import type { WhatsAppDocument, WhatsAppSender } from "@/modules/whatsapp/client";
import { WhatsAppError } from "@/modules/whatsapp/client";
import {
  listMessages,
  runAutomaticReminders,
  saveNotificationSettings,
  sendMeetingAgendaToManager,
  sendMeetingReminderToGroup,
  sendMonthlyMetricsToManager,
  sendOccurrencesToManager,
} from "@/modules/whatsapp/service";
import { carryOverPending, createCard, deleteCard, listBoard, moveCard, updateCard } from "@/modules/kanban/service";
import { createUser, disconnect, hasTestDb, resetDb, testDb, withPermissions } from "../support/db";
import { makeEmployee, occurrenceType } from "../support/factories";

type Sent = { to: string; text?: string; doc?: WhatsAppDocument };

function fakeSender(fail = false): WhatsAppSender & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async sendText(to, text) {
      if (fail) throw new WhatsAppError("O WhatsApp recusou o envio: número inexistente.");
      sent.push({ to, text });
    },
    async sendDocument(to, doc) {
      if (fail) throw new WhatsAppError("O WhatsApp recusou o envio.");
      sent.push({ to, doc });
    },
    async connectionState() {
      return "open";
    },
    async fetchGroups() {
      return [];
    },
  };
}

const settings = { managerName: "Marta", managerPhone: "(11) 98888-7777", groupName: "Suporte Interno", groupJid: "120363000000000001@g.us", reminderEnabled: "on", reminderHoursBefore: "2" };

describe.skipIf(!hasTestDb)("WhatsApp", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("valida destinatários e exige o grupo para o aviso automático", async () => {
    const sup = await createUser();
    await expect(saveNotificationSettings(testDb(), sup, { ...settings, managerPhone: "123" })).rejects.toThrow(/telefone/);
    await expect(saveNotificationSettings(testDb(), sup, { ...settings, groupJid: "" })).rejects.toThrow(/grupo/);
    await expect(saveNotificationSettings(testDb(), sup, { ...settings, groupJid: "abc@s.whatsapp.net" })).rejects.toThrow();
    const s = await saveNotificationSettings(testDb(), sup, settings);
    expect(s.managerPhone).toBe("5511988887777");
    const assistant = await createUser("ASSISTANT");
    await expect(saveNotificationSettings(testDb(), assistant, settings)).rejects.toBeInstanceOf(AppError);
  });

  it("envia ocorrências da folha, relatório mensal e pauta ao gestor, com histórico", async () => {
    const sup = await createUser();
    const sender = fakeSender();
    await expect(sendMeetingAgendaToManager(testDb(), sup, "00000000-0000-7000-8000-000000000000", sender)).rejects.toThrow();
    await expect(sendOccurrencesToManager(testDb(), sup, {}, sender)).rejects.toThrow(/número do gestor/);
    await saveNotificationSettings(testDb(), sup, settings);

    const e = await makeEmployee(sup, { fullName: "Rui" });
    const falta = await occurrenceType("FALTA");
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-10-05", adminNotes: "não enviar" });
    const occ = await sendOccurrencesToManager(testDb(), sup, { folha: parseDateKey("2026-10-10") }, sender);
    expect(occ.summary).toContain("20/09/2026 a 19/10/2026");
    expect(sender.sent[0]).toMatchObject({ to: "5511988887777", doc: { mimetype: "application/pdf", fileName: "ocorrencias-folha-2026-09-20.pdf" } });
    expect(Buffer.from(sender.sent[0].doc!.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(sender.sent[1].text).toContain("Rui");
    expect(sender.sent[1].text).not.toContain("não enviar");

    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-10-05", ticketsHandled: "80", avgHandleMinutes: "5", avgRating: "9.5", ratingCount: "12" }, parseDateKey("2026-10-23"));
    await sendMonthlyMetricsToManager(testDb(), sup, { month: parseDateKey("2026-10-01") }, sender);
    expect(sender.sent[2].doc?.fileName).toBe("relatorio-mensal-2026-10.pdf");
    expect(sender.sent[2].doc?.caption).toContain("Outubro de 2026");
    expect(sender.sent[2].doc?.caption).toContain("12 avaliações");

    const m = await createMeeting(testDb(), sup, { title: "Semanal", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", location: "Sala 2", agenda: "## Pauta\n- [ ] **Escala** de novembro" });
    await sendMeetingAgendaToManager(testDb(), sup, m.id, sender);
    expect(sender.sent[3].text).toContain("*Pauta — Semanal*");
    expect(sender.sent[3].text).toContain("☐ *Escala* de novembro");
    expect(sender.sent[3].text).toContain("Segunda-feira, 26/10/2026 · 09:00");

    const log = await listMessages(testDb(), sup);
    expect(log.items.map((i) => [i.kind, i.status])).toEqual([["MEETING_AGENDA", "SENT"], ["MONTHLY_METRICS", "SENT"], ["OCCURRENCES", "SENT"]]);
    expect(log.items[0].destination).toContain("Marta");
    expect(log.items[0].destination).not.toContain("98888");
    expect(await testDb().auditLog.count({ where: { action: "SEND_WHATSAPP" } })).toBe(3);
  });

  it("registra falhas de envio sem marcar o aviso como enviado", async () => {
    const sup = await createUser();
    await saveNotificationSettings(testDb(), sup, settings);
    const m = await createMeeting(testDb(), sup, { title: "Semanal", type: "WEEKLY", date: "2026-10-26", startTime: "09:00" });
    await expect(sendMeetingReminderToGroup(testDb(), sup, m.id, fakeSender(true))).rejects.toThrow(/inexistente/);
    const [msg] = (await listMessages(testDb(), sup)).items;
    expect(msg).toMatchObject({ status: "FAILED", target: "GROUP", destination: "Suporte Interno" });
    expect((await testDb().meeting.findUniqueOrThrow({ where: { id: m.id } })).reminderSentAt).toBeNull();
  });

  it("aviso automático: só reuniões semanais, dentro da janela, uma vez", async () => {
    const sup = await createUser();
    await saveNotificationSettings(testDb(), sup, settings);
    const weekly = await createMeeting(testDb(), sup, { title: "Reunião semanal", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", agenda: "- [ ] Avisos" });
    await createMeeting(testDb(), sup, { title: "Extra", type: "EXTRAORDINARY", date: "2026-10-26", startTime: "09:30" });
    const sender = fakeSender();
    // 26/10 09:00 em São Paulo = 12:00 UTC; janela de 2 h abre às 10:00 UTC
    expect((await runAutomaticReminders(testDb(), sender, new Date("2026-10-26T09:59:00Z"))).sent).toBe(0);
    expect((await runAutomaticReminders(testDb(), sender, new Date("2026-10-26T10:05:00Z"))).sent).toBe(1);
    expect((await runAutomaticReminders(testDb(), sender, new Date("2026-10-26T10:15:00Z"))).sent).toBe(0);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("120363000000000001@g.us");
    expect(sender.sent[0].text).toContain("Lembrete de reunião");
    expect(sender.sent[0].text).toContain("*Pauta:*\n\n☐ Avisos");
    expect(sender.sent[0].text).toContain("Conto com a presença de todos!");
    const msg = await testDb().outboundMessage.findFirstOrThrow();
    expect(msg).toMatchObject({ automatic: true, sentById: null, entityId: weekly.id });

    // Editar a pauta não reenvia o aviso
    await saveAgenda(testDb(), sup, weekly.id, { agenda: "- [ ] Avisos atualizados" });
    expect((await testDb().meeting.findUniqueOrThrow({ where: { id: weekly.id } })).reminderSentAt).not.toBeNull();

    await saveNotificationSettings(testDb(), sup, { ...settings, reminderEnabled: "" });
    expect(await runAutomaticReminders(testDb(), sender, new Date("2026-10-26T10:30:00Z"))).toMatchObject({ skipped: "desativado" });
  });
});

describe.skipIf(!hasTestDb)("Kanban", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("cria, move entre colunas mantendo a ordem, edita e exclui", async () => {
    const sup = await createUser();
    const week = "2026-10-21";
    const a = await createCard(testDb(), sup, { week, title: "Revisar escala" });
    const b = await createCard(testDb(), sup, { week, title: "Feedback da Ana", priority: "HIGH", dueDate: "2026-10-22" });
    const c = await createCard(testDb(), sup, { week, title: "Pauta da semanal" });
    expect(a.weekStart.toISOString().slice(0, 10)).toBe("2026-10-19");

    await moveCard(testDb(), sup, c.id, { column: "TODO", index: 0 });
    let board = await listBoard(testDb(), sup, parseDateKey(week));
    expect(board.cards.filter((x) => x.column === "TODO").map((x) => x.title)).toEqual(["Pauta da semanal", "Revisar escala", "Feedback da Ana"]);

    await moveCard(testDb(), sup, a.id, { column: "DONE", index: 0 });
    await moveCard(testDb(), sup, b.id, { column: "DOING", index: 5 });
    board = await listBoard(testDb(), sup, parseDateKey(week));
    const pos = (col: string) => board.cards.filter((x) => x.column === col).map((x) => [x.title, x.position]);
    expect(pos("TODO")).toEqual([["Pauta da semanal", 0]]);
    expect(pos("DOING")).toEqual([["Feedback da Ana", 0]]);
    expect(pos("DONE")).toEqual([["Revisar escala", 0]]);
    expect(board.cards.find((x) => x.id === a.id)?.completedAt).not.toBeNull();

    await moveCard(testDb(), sup, a.id, { column: "TODO", index: 1 });
    expect((await testDb().kanbanCard.findUniqueOrThrow({ where: { id: a.id } })).completedAt).toBeNull();

    await updateCard(testDb(), sup, b.id, { title: "Feedback da Ana (remarcado)", priority: "LOW", description: "Sala 3" });
    expect(await testDb().kanbanCard.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ title: "Feedback da Ana (remarcado)", priority: "LOW", dueDate: null });
    await deleteCard(testDb(), sup, c.id);
    expect(await testDb().kanbanCard.count()).toBe(2);
    await expect(createCard(testDb(), sup, { week, title: "  " })).rejects.toThrow();
    await expect(moveCard(testDb(), sup, a.id, { column: "LIXO", index: 0 })).rejects.toThrow();
  });

  it("traz pendências de semanas anteriores; concluídas ficam onde estão", async () => {
    const sup = await createUser();
    await createCard(testDb(), sup, { week: "2026-10-12", title: "Pendente antiga" });
    await createCard(testDb(), sup, { week: "2026-10-12", title: "Em andamento", column: "DOING" });
    await createCard(testDb(), sup, { week: "2026-10-12", title: "Feita", column: "DONE" });
    await createCard(testDb(), sup, { week: "2026-10-19", title: "Desta semana" });
    expect((await listBoard(testDb(), sup, parseDateKey("2026-10-19"))).pendingBefore).toBe(2);
    expect(await carryOverPending(testDb(), sup, parseDateKey("2026-10-19"))).toBe(2);
    const board = await listBoard(testDb(), sup, parseDateKey("2026-10-19"));
    expect(board.pendingBefore).toBe(0);
    expect(board.cards.map((c) => [c.title, c.column, c.position])).toEqual([["Desta semana", "TODO", 0], ["Pendente antiga", "TODO", 1], ["Em andamento", "DOING", 0]]);
    expect((await listBoard(testDb(), sup, parseDateKey("2026-10-12"))).cards.map((c) => c.title)).toEqual(["Feita"]);
  });

  it("exige permissão", async () => {
    const sup = await createUser();
    await expect(listBoard(testDb(), withPermissions(sup, ["meetings:read"]), parseDateKey("2026-10-19"))).rejects.toBeInstanceOf(AppError);
    const assistant = await createUser("ASSISTANT");
    await expect(createCard(testDb(), assistant, { week: "2026-10-19", title: "x" })).rejects.toBeInstanceOf(AppError);
  });
});
