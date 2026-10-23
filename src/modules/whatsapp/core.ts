import { z } from "zod";
import type { Db } from "@/lib/db";
import type { MessageTarget } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { addDays, formatDate, formatTime, todayInTimeZone, zonedDateTimeToUtc } from "@/lib/dates";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { markdownToWhatsApp } from "@/lib/markdown";
import { assertCan, type Actor } from "@/lib/permissions";
import { formatCode } from "@/lib/text";
import { intField, optionalText, PAGE_SIZE } from "@/lib/validation";
import { WhatsAppError, type WhatsAppDocument, type WhatsAppSender } from "./client";

/**
 * Núcleo dos envios pelo WhatsApp: destinatários, entrega com registro, pauta e aviso de
 * reunião. Não depende dos relatórios, para o aviso automático rodar em script separado
 * (scripts/send-reminders.ts). Cada envio fica registrado em OutboundMessage (sem o
 * conteúdo dos anexos) e na auditoria.
 */

export const MESSAGE_KINDS = {
  OCCURRENCES: "Ocorrências da folha",
  MONTHLY_METRICS: "Relatório mensal de métricas",
  MEETING_AGENDA: "Pauta de reunião",
  MEETING_REMINDER: "Aviso de reunião",
  TEST: "Mensagem de teste",
} as const;
export type MessageKind = keyof typeof MESSAGE_KINDS;

export function timeZone() {
  return process.env.APP_TIMEZONE || "America/Sao_Paulo";
}

// ───────────── Configuração ─────────────

const SINGLETON = 1;

export async function getNotificationSettings(db: Db) {
  return (await db.notificationSettings.findUnique({ where: { id: SINGLETON } })) ?? {
    id: SINGLETON,
    managerName: null,
    managerPhone: null,
    groupName: null,
    groupJid: null,
    reminderEnabled: false,
    reminderHoursBefore: 2,
    updatedById: null,
    updatedAt: new Date(0),
  };
}

/** Número em formato internacional, só dígitos; números brasileiros sem DDI ganham 55. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const full = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^\d{12,15}$/.test(full) ? full : null;
}

export function maskPhone(phone: string): string {
  return phone.length > 6 ? `+${phone.slice(0, 4)} ••••${phone.slice(-4)}` : "••••";
}

const settingsSchema = z.object({
  managerName: optionalText(120),
  managerPhone: optionalText(30),
  groupName: optionalText(120),
  groupJid: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z.string().regex(/^[0-9]{5,30}(-[0-9]+)?@g\.us$/, "Identificador de grupo inválido (termina em @g.us).").optional(),
  ),
  reminderEnabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  reminderHoursBefore: intField("a antecedência do aviso (horas)", 0, 72),
});

export async function saveNotificationSettings(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "messages:send");
  const v = settingsSchema.parse(raw);
  const managerPhone = v.managerPhone ? normalizePhone(v.managerPhone) : null;
  if (v.managerPhone && !managerPhone) throw new ValidationError("Revise o telefone do gestor.", { managerPhone: "Informe DDD e número, ex.: (11) 99999-8888." });
  if (v.reminderEnabled && !v.groupJid) throw new ValidationError("Escolha o grupo antes de ativar o aviso automático.", { groupJid: "Obrigatório para o aviso automático." });
  const data = {
    managerName: v.managerName ?? null,
    managerPhone,
    groupName: v.groupName ?? null,
    groupJid: v.groupJid ?? null,
    reminderEnabled: v.reminderEnabled,
    reminderHoursBefore: v.reminderHoursBefore,
    updatedById: actor.id,
  };
  const before = await getNotificationSettings(db);
  const after = await db.notificationSettings.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
  await audit(db, { actorId: actor.id, action: "UPDATE", entityType: "NotificationSettings", entityId: String(SINGLETON), summary: "Destinatários do WhatsApp atualizados", before, after });
  return after;
}

async function destination(db: Db, target: MessageTarget) {
  const s = await getNotificationSettings(db);
  if (target === "MANAGER") {
    if (!s.managerPhone) throw new WhatsAppError("Cadastre o número do gestor em WhatsApp › Destinatários.");
    return { to: s.managerPhone, label: s.managerName ? `${s.managerName} (${maskPhone(s.managerPhone)})` : maskPhone(s.managerPhone) };
  }
  if (!s.groupJid) throw new WhatsAppError("Escolha o grupo do Suporte Interno em WhatsApp › Destinatários.");
  return { to: s.groupJid, label: s.groupName ?? "Grupo" };
}

// ───────────── Entrega com registro ─────────────

type Delivery = {
  kind: MessageKind;
  target: MessageTarget;
  summary: string;
  entityId?: string | null;
  text?: string;
  document?: WhatsAppDocument;
  automatic?: boolean;
};

export async function deliver(db: Db, actorId: string | null, sender: WhatsAppSender, d: Delivery) {
  const dest = await destination(db, d.target);
  try {
    if (d.document) await sender.sendDocument(dest.to, d.document);
    if (d.text) await sender.sendText(dest.to, d.text);
  } catch (e) {
    const error = e instanceof WhatsAppError ? e.message : "Falha inesperada no envio.";
    await db.outboundMessage.create({ data: { kind: d.kind, target: d.target, destination: dest.label, summary: d.summary, status: "FAILED", error, entityId: d.entityId ?? null, automatic: d.automatic ?? false, sentById: actorId } });
    if (e instanceof WhatsAppError) throw e;
    console.error("[whatsapp] falha inesperada:", e instanceof Error ? e.name : "desconhecido");
    throw new WhatsAppError("Falha inesperada no envio pelo WhatsApp.");
  }
  const msg = await db.outboundMessage.create({ data: { kind: d.kind, target: d.target, destination: dest.label, summary: d.summary, status: "SENT", entityId: d.entityId ?? null, automatic: d.automatic ?? false, sentById: actorId } });
  await audit(db, { actorId, action: "SEND_WHATSAPP", entityType: "OutboundMessage", entityId: msg.id, summary: `${MESSAGE_KINDS[d.kind]} enviado para ${dest.label}: ${d.summary}` });
  return { ...msg, destinationLabel: dest.label };
}

const longWeekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" });

function meetingWhen(m: { date: Date; startMinute: number; endMinute: number | null }) {
  const wd = longWeekday.format(m.date);
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${formatDate(m.date)} · ${formatTime(m.startMinute)}${m.endMinute ? `–${formatTime(m.endMinute)}` : ""}`;
}

async function loadMeeting(db: Db, id: string) {
  const m = await db.meeting.findUnique({ where: { id }, include: { decisions: { orderBy: { position: "asc" } } } });
  if (!m || m.deletedAt) throw new NotFoundError("Reunião não encontrada.");
  return m;
}

/** Texto da pauta para o gestor (com decisões, quando já registradas). */
export function meetingAgendaText(m: { title: string; code: number; date: Date; startMinute: number; endMinute: number | null; location: string | null; agenda: string; decisions: Array<{ description: string }> }) {
  const lines = [`*Pauta — ${m.title}*`, `🗓 ${meetingWhen(m)}`];
  if (m.location) lines.push(`📍 ${m.location}`);
  lines.push("", m.agenda.trim() ? markdownToWhatsApp(m.agenda) : "_Pauta ainda não preenchida._");
  if (m.decisions.length) lines.push("", "*Decisões e encaminhamentos*", ...m.decisions.map((d) => `• ${d.description}`));
  lines.push("", `_${formatCode("meeting", m.code)} · Supervisão de Atendimento_`);
  return lines.join("\n");
}

export async function sendMeetingAgendaToManager(db: Db, actor: Actor, meetingId: string, sender: WhatsAppSender) {
  assertCan(actor, "messages:send");
  assertCan(actor, "meetings:read");
  const m = await loadMeeting(db, meetingId);
  return deliver(db, actor.id, sender, {
    kind: "MEETING_AGENDA",
    target: "MANAGER",
    summary: `${m.title} (${formatDate(m.date)})`,
    entityId: m.id,
    text: meetingAgendaText(m),
  });
}

// ───────────── Grupo ─────────────

export function meetingReminderText(m: { title: string; date: Date; startMinute: number; endMinute: number | null; location: string | null; agenda: string }) {
  const lines = ["📣 *Lembrete de reunião*", "", `*${m.title}*`, `🗓 ${meetingWhen(m)}`];
  if (m.location) lines.push(`📍 ${m.location}`);
  if (m.agenda.trim()) lines.push("", "*Pauta*", markdownToWhatsApp(m.agenda));
  lines.push("", "Contamos com a presença de todos!");
  return lines.join("\n");
}

export async function sendMeetingReminderToGroup(db: Db, actor: Actor, meetingId: string, sender: WhatsAppSender) {
  assertCan(actor, "messages:send");
  const m = await loadMeeting(db, meetingId);
  const msg = await deliver(db, actor.id, sender, { kind: "MEETING_REMINDER", target: "GROUP", summary: `${m.title} (${formatDate(m.date)})`, entityId: m.id, text: meetingReminderText(m) });
  await db.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
  return msg;
}

/**
 * Aviso automático: reuniões semanais agendadas cujo início está a até N horas.
 * Executado periodicamente (deploy/supervisao-avisos.timer). Cada reunião recebe um aviso só.
 */
export async function runAutomaticReminders(db: Db, sender: WhatsAppSender, now: Date = new Date()) {
  const s = await getNotificationSettings(db);
  if (!s.reminderEnabled || !s.groupJid) return { sent: 0, failed: 0, skipped: "desativado" as const };
  const tz = timeZone();
  const today = todayInTimeZone(tz, now);
  const candidates = await db.meeting.findMany({
    where: { deletedAt: null, status: "SCHEDULED", type: "WEEKLY", reminderSentAt: null, date: { gte: addDays(today, -1), lte: addDays(today, 4) } },
    orderBy: [{ date: "asc" }, { startMinute: "asc" }],
  });
  let sent = 0;
  let failed = 0;
  for (const m of candidates) {
    const start = zonedDateTimeToUtc(m.date, m.startMinute, tz).getTime();
    const opensAt = start - s.reminderHoursBefore * 3_600_000;
    if (now.getTime() < opensAt || now.getTime() >= start) continue;
    try {
      await deliver(db, null, sender, { kind: "MEETING_REMINDER", target: "GROUP", summary: `${m.title} (${formatDate(m.date)})`, entityId: m.id, text: meetingReminderText(m), automatic: true });
      await db.meeting.update({ where: { id: m.id }, data: { reminderSentAt: new Date() } });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed, skipped: null };
}

// ───────────── Teste e histórico ─────────────

export async function sendTestMessage(db: Db, actor: Actor, target: MessageTarget, sender: WhatsAppSender) {
  assertCan(actor, "messages:send");
  return deliver(db, actor.id, sender, {
    kind: "TEST",
    target,
    summary: "Teste de conexão",
    text: `✅ Teste do sistema de Supervisão de Atendimento. ${target === "GROUP" ? "Os avisos de reunião chegarão neste grupo." : "Os relatórios chegarão neste número."}`,
  });
}

export async function listMessages(db: Db, actor: Actor, page = 1) {
  assertCan(actor, "messages:send");
  const [total, items] = await Promise.all([
    db.outboundMessage.count(),
    db.outboundMessage.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

export async function lastMessagesFor(db: Db, entityId: string) {
  return db.outboundMessage.findMany({ where: { entityId }, orderBy: { createdAt: "desc" }, take: 5 });
}
