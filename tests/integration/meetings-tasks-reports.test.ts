import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseDateKey } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import {
  addAgendaItem,
  createMeeting,
  createSeries,
  deleteMeeting,
  generateSeriesMeetings,
  getMeeting,
  moveAgendaItem,
  removeAgendaItem,
} from "@/modules/meetings/service";
import { createTask, getTask, listTasks, setTaskStatus, updateTask } from "@/modules/tasks/service";
import { createMetric } from "@/modules/metrics/service";
import { createOccurrence } from "@/modules/attendance/occurrences";
import { createFeedback } from "@/modules/feedbacks/service";
import { buildReport, reportParamsSchema } from "@/modules/reports/service";
import { renderExcel, renderPdf, sanitizeCell } from "@/modules/reports/render";
import { createUser, disconnect, hasTestDb, resetDb, testDb } from "../support/db";
import { makeEmployee, occurrenceType } from "../support/factories";

const TODAY = parseDateKey("2026-10-22");

describe.skipIf(!hasTestDb)("reuniões e tarefas", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("pauta ordenável e separada de anotações e ações", async () => {
    const sup = await createUser();
    const m = await createMeeting(testDb(), sup, { title: "Semanal", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", agenda: "A\nB\nC" });
    const full = await getMeeting(testDb(), sup, m.id);
    expect(full.agendaItems.map((i) => i.title)).toEqual(["A", "B", "C"]);
    await moveAgendaItem(testDb(), sup, full.agendaItems[2].id, "up");
    await moveAgendaItem(testDb(), sup, full.agendaItems[0].id, "down");
    const after = await getMeeting(testDb(), sup, m.id);
    expect(after.agendaItems.map((i) => i.title)).toEqual(["C", "A", "B"]);
    await addAgendaItem(testDb(), sup, m.id, { title: "D" });
    await removeAgendaItem(testDb(), sup, after.agendaItems[0].id);
    const final = await getMeeting(testDb(), sup, m.id);
    expect(final.agendaItems.map((i) => [i.title, i.position])).toEqual([["A", 0], ["B", 1], ["D", 2]]);
  });

  it("reutiliza pauta de reunião anterior", async () => {
    const sup = await createUser();
    const m1 = await createMeeting(testDb(), sup, { title: "Original", type: "WEEKLY", date: "2026-10-19", startTime: "09:00", agenda: "Item 1\nItem 2" });
    const m2 = await createMeeting(testDb(), sup, { title: "Cópia", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", copyFromMeetingId: m1.id });
    expect((await getMeeting(testDb(), sup, m2.id)).agendaItems.map((i) => i.title)).toEqual(["Item 1", "Item 2"]);
  });

  it("vincula tarefas à reunião e ao colaborador; exclusão da reunião preserva a tarefa", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMeeting(testDb(), sup, { title: "Alinhamento", type: "EXTRAORDINARY", date: "2026-10-20", startTime: "14:00", participantIds: [e.id] });
    const t = await createTask(testDb(), sup, { title: "Revisar escala", meetingId: m.id, assignee: `employee:${e.id}`, dueDate: "2026-10-21", employeeId: e.id });
    const meeting = await getMeeting(testDb(), sup, m.id);
    expect(meeting.tasks.map((x) => x.id)).toEqual([t.id]);
    expect(meeting.participants[0].employeeId).toBe(e.id);
    const overdue = await listTasks(testDb(), sup, { due: "overdue" }, TODAY);
    expect(overdue.items.map((x) => x.id)).toEqual([t.id]);
    const byEmployee = await listTasks(testDb(), sup, { employeeId: e.id }, TODAY);
    expect(byEmployee.total).toBe(1);
    await deleteMeeting(testDb(), sup, m.id);
    const task = await getTask(testDb(), sup, t.id);
    expect(task.meetingId).toBe(m.id);
    expect(task.meeting?.deletedAt).not.toBeNull();
  });

  it("rejeita vínculos inexistentes", async () => {
    const sup = await createUser();
    await expect(createTask(testDb(), sup, { title: "X", meetingId: "0199f6b0-0000-7000-8000-000000000000" })).rejects.toThrow(AppError);
  });

  it("registra histórico de alterações da tarefa", async () => {
    const sup = await createUser();
    const t = await createTask(testDb(), sup, { title: "Original", priority: "LOW" });
    await updateTask(testDb(), sup, t.id, { title: "Renomeada", priority: "URGENT", status: "IN_PROGRESS", dueDate: "2026-11-01" });
    await setTaskStatus(testDb(), sup, t.id, "DONE");
    const full = await getTask(testDb(), sup, t.id);
    const fields = full.events.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["created", "Título", "Prioridade", "Status", "Prazo"]));
    expect(full.completedAt).not.toBeNull();
    const statusEvents = full.events.filter((e) => e.field === "Status").map((e) => e.toValue);
    expect(statusEvents).toEqual(expect.arrayContaining(["Em andamento", "Concluída"]));
  });

  it("não revela vínculo com feedback para quem não tem acesso", async () => {
    const sup = await createUser();
    const asst = await createUser("ASSISTANT");
    const e = await makeEmployee(sup);
    const f = await createFeedback(testDb(), sup, { employeeId: e.id, date: "2026-10-01", type: "DEVELOPMENT", context: "Plano" });
    const t = await createTask(testDb(), sup, { title: "Acompanhar plano", feedbackId: f.id });
    const seen = await getTask(testDb(), asst, t.id);
    expect(seen.feedbackId).toBeNull();
    expect(seen.feedback).toBeNull();
    // Assistente não consegue criar vínculo com feedback
    await expect(createTask(testDb(), asst, { title: "Y", feedbackId: f.id })).rejects.toThrow(/permissão/);
  });

  it("série semanal gera instâncias de forma idempotente", async () => {
    const sup = await createUser();
    const s = await createSeries(testDb(), sup, { title: "Semanal", weekday: "1", startTime: "09:00", endTime: "10:00", startDate: "2026-10-22", weeksAhead: "3" });
    const meetings = await testDb().meeting.findMany({ where: { seriesId: s.id }, orderBy: { date: "asc" } });
    expect(meetings.map((m) => m.date.toISOString().slice(0, 10))).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    await generateSeriesMeetings(testDb(), sup, s.id, 2);
    expect(await testDb().meeting.count({ where: { seriesId: s.id } })).toBe(5);
  });
});

describe("proteção de células do Excel", () => {
  it("neutraliza fórmulas maliciosas", () => {
    expect(sanitizeCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeCell("+1+1")).toBe("'+1+1");
    expect(sanitizeCell("-2")).toBe("'-2");
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCell("\tcmd")).toBe("'\tcmd");
    expect(sanitizeCell("Texto normal")).toBe("Texto normal");
    expect(sanitizeCell(-5)).toBe(-5);
    expect(sanitizeCell(null)).toBeNull();
  });
});

describe.skipIf(!hasTestDb)("relatórios", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  const params = (over: Record<string, string>) => reportParamsSchema.parse({ formato: "xlsx", ...over });

  it("valida parâmetros", () => {
    expect(reportParamsSchema.safeParse({ tipo: "inexistente", formato: "xlsx" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ tipo: "metricas", formato: "doc" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ tipo: "metricas", formato: "pdf", de: "2026-10-10", ate: "2026-10-01" }).success).toBe(false);
    expect(reportParamsSchema.safeParse({ tipo: "metricas", formato: "pdf", de: "2026-13-01" }).success).toBe(false);
  });

  it("gera Excel válido com dados reais, filtros, totais e células protegidas", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup, { fullName: "=cmd|' /C calc'!A0" });
    await createMetric(testDb(), sup, { employeeId: e.id, month: "2026-09", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "9", notes: "+SUM(1,2)" });
    const other = await makeEmployee(sup);
    await createMetric(testDb(), sup, { employeeId: other.id, month: "2026-09", ticketsHandled: "300", avgHandleMinutes: "7", avgRating: "7" });
    const report = await buildReport(testDb(), sup, params({ tipo: "metricas", de: "2026-09-01", ate: "2026-09-30" }), TODAY);
    expect(report.rows).toHaveLength(2);
    expect(report.totals?.tickets).toBe(400);
    expect(report.totals?.aht).toBe(6.5);

    const buf = await renderExcel(report, "America/Sao_Paulo");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const values: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => values.push(c.value)));
    expect(values).toContain("'=cmd|' /C calc'!A0");
    expect(values).toContain("'+SUM(1,2)");
    expect(values.some((v) => typeof v === "object" && v !== null && "formula" in (v as object))).toBe(false);

    const filtered = await buildReport(testDb(), sup, params({ tipo: "metricas", de: "2026-09-01", ate: "2026-09-30", colaborador: other.id }), TODAY);
    expect(filtered.rows).toHaveLength(1);
    expect(await testDb().auditLog.count({ where: { action: "EXPORT" } })).toBe(2);
  });

  it("gera PDF válido, inclusive sem registros", async () => {
    const sup = await createUser();
    const report = await buildReport(testDb(), sup, params({ tipo: "tarefas", formato: "pdf" }), TODAY);
    const pdf = await renderPdf(report, "America/Sao_Paulo");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(800);
  });

  it("relatório de frequência exclui dados restritos e observações de tipos médicos", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const atestado = await occurrenceType("ATESTADO");
    const falta = await occurrenceType("FALTA");
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atestado.id, date: "2026-10-05", adminNotes: "nota de atestado", restrictedNotes: "CID-SECRETO" });
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-10-06", adminNotes: "nota administrativa" });
    const plain = await buildReport(testDb(), sup, params({ tipo: "frequencia", de: "2026-10-01", ate: "2026-10-31" }), TODAY);
    const withNotes = await buildReport(testDb(), sup, params({ tipo: "frequencia", de: "2026-10-01", ate: "2026-10-31", observacoes: "1" }), TODAY);
    const a = JSON.stringify(plain);
    const b = JSON.stringify(withNotes);
    expect(a).not.toContain("nota administrativa");
    expect(b).toContain("nota administrativa");
    expect(b).not.toContain("nota de atestado");
    expect(a + b).not.toContain("CID-SECRETO");
  });

  it("feedbacks exigem confirmação explícita; detalhes só quando selecionados", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await createFeedback(testDb(), sup, { employeeId: e.id, date: "2026-10-01", type: "DEVELOPMENT", context: "Contexto detalhado" });
    await expect(buildReport(testDb(), sup, params({ tipo: "feedbacks" }), TODAY)).rejects.toThrow(/Confirme/);
    const basic = await buildReport(testDb(), sup, params({ tipo: "feedbacks", confirmar: "1", de: "2026-01-01", ate: "2026-12-31" }), TODAY);
    expect(basic.rows).toHaveLength(1);
    expect(basic.columns.map((c) => c.key)).not.toContain("context");
    const detailed = await buildReport(testDb(), sup, params({ tipo: "feedbacks", confirmar: "1", detalhes: "1", de: "2026-01-01", ate: "2026-12-31" }), TODAY);
    expect(detailed.columns.map((c) => c.key)).toContain("context");
  });

  it("respeita permissões do módulo de origem", async () => {
    const asst = await createUser("ASSISTANT");
    await expect(buildReport(testDb(), asst, params({ tipo: "frequencia" }), TODAY)).rejects.toThrow(AppError);
  });
});
