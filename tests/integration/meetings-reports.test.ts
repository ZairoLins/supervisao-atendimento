import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseDateKey } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import {
  addDecision,
  createMeeting,
  createSeries,
  deleteMeeting,
  generateSeriesMeetings,
  getMeeting,
  resetTasks,
  saveAgenda,
  templateFromMeeting,
  toggleAgendaTask,
} from "@/modules/meetings/service";
import { createMetric } from "@/modules/metrics/service";
import { createOccurrence } from "@/modules/attendance/occurrences";
import { createFeedback } from "@/modules/feedbacks/service";
import { buildMetricsReport, buildOccurrencesReport, buildReport, reportParamsSchema } from "@/modules/reports/service";
import { metricsReportFileName, renderMetricsExcel, renderMetricsPdf } from "@/modules/reports/metrics-report";
import { occurrencesSummaryText, payrollPeriod, previousPayrollPeriod, renderOccurrencesPdf } from "@/modules/reports/occurrences-report";
import { renderExcel, renderPdf, sanitizeCell } from "@/modules/reports/render";
import { createUser, disconnect, hasTestDb, resetDb, testDb } from "../support/db";
import { makeEmployee, occurrenceType } from "../support/factories";

const TODAY = parseDateKey("2026-10-22");

describe.skipIf(!hasTestDb)("reuniões", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("pauta em Markdown: checklist marcado como discutido e separado das anotações", async () => {
    const sup = await createUser();
    const agenda = "## Abertura\n- [ ] Recados\n- [ ] **Indicadores**\n\nTexto livre";
    const m = await createMeeting(testDb(), sup, { title: "Semanal", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", agenda: agenda.replace(/\n/g, "\r\n") + "\r\n\n" });
    expect((await getMeeting(testDb(), sup, m.id)).agenda).toBe(agenda);
    await toggleAgendaTask(testDb(), sup, m.id, 3);
    expect((await getMeeting(testDb(), sup, m.id)).agenda).toBe("## Abertura\n- [ ] Recados\n- [x] **Indicadores**\n\nTexto livre");
    await expect(toggleAgendaTask(testDb(), sup, m.id, 1)).rejects.toBeInstanceOf(AppError);
    await saveAgenda(testDb(), sup, m.id, { agenda: "- [ ] Novo item" });
    const after = await getMeeting(testDb(), sup, m.id);
    expect(after.agenda).toBe("- [ ] Novo item");
    expect(after.minutes).toBeNull();
    expect(after.searchText).toContain("novo item");
  });

  it("reutiliza pauta de reunião anterior e de modelo, desmarcando o que foi discutido", async () => {
    const sup = await createUser();
    const m1 = await createMeeting(testDb(), sup, { title: "Original", type: "WEEKLY", date: "2026-10-19", startTime: "09:00", agenda: "- [x] Item 1\n- [ ] Item 2" });
    const m2 = await createMeeting(testDb(), sup, { title: "Cópia", type: "WEEKLY", date: "2026-10-26", startTime: "09:00", copyFromMeetingId: m1.id });
    expect((await getMeeting(testDb(), sup, m2.id)).agenda).toBe("- [ ] Item 1\n- [ ] Item 2");
    const t = await templateFromMeeting(testDb(), sup, m1.id, { name: "Semanal padrão" });
    expect(t.agenda).toBe("- [ ] Item 1\n- [ ] Item 2");
    const m3 = await createMeeting(testDb(), sup, { title: "Do modelo", type: "WEEKLY", date: "2026-11-02", startTime: "09:00", templateId: t.id });
    expect((await getMeeting(testDb(), sup, m3.id)).agenda).toBe("- [ ] Item 1\n- [ ] Item 2");
    expect(resetTasks("1. [X] a\n  - [x] b")).toBe("1. [ ] a\n  - [ ] b");
  });

  it("registra decisões e participantes; exclusão é lógica", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMeeting(testDb(), sup, { title: "Alinhamento", type: "EXTRAORDINARY", date: "2026-10-20", startTime: "14:00", participantIds: [e.id] });
    await addDecision(testDb(), sup, m.id, { description: "Revisar escala de dezembro" });
    const meeting = await getMeeting(testDb(), sup, m.id);
    expect(meeting.decisions.map((d) => d.description)).toEqual(["Revisar escala de dezembro"]);
    expect(meeting.participants[0].employeeId).toBe(e.id);
    await deleteMeeting(testDb(), sup, m.id);
    expect((await testDb().meeting.findUniqueOrThrow({ where: { id: m.id } })).deletedAt).not.toBeNull();
    await expect(getMeeting(testDb(), sup, m.id)).rejects.toThrow(AppError);
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
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-09-10", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "9", ratingCount: "100", notes: "+SUM(1,2)" }, TODAY);
    const other = await makeEmployee(sup);
    await createMetric(testDb(), sup, { employeeId: other.id, week: "2026-09-11", ticketsHandled: "300", avgHandleMinutes: "7", avgRating: "7", ratingCount: "300" }, TODAY);
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

  it("relatório semanal: PDF com design próprio e Excel formatado, inclusive semana vazia", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup, { fullName: "=Ana" });
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-10-12", ticketsHandled: "90", avgHandleMinutes: "5", avgRating: "8", ratingCount: "90" }, TODAY);
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-10-19", ticketsHandled: "120", avgHandleMinutes: "4.5", avgRating: "9.1", ratingCount: "120", notes: "Campanha" }, TODAY);
    const weekly = await buildMetricsReport(testDb(), sup, params({ tipo: "semanal", formato: "pdf", semana: "2026-10-21" }), TODAY);
    expect(weekly.rows).toHaveLength(1);
    expect(weekly.rows[0].prev?.tickets).toBe(90);
    const pdf = await renderMetricsPdf(weekly, "America/Sao_Paulo");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await renderMetricsExcel(weekly, "America/Sao_Paulo");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    const values: unknown[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => values.push(c.value)));
    expect(values).toContain("'=Ana");
    expect(values).toContain(120);
    const empty = await buildMetricsReport(testDb(), sup, params({ tipo: "semanal", formato: "pdf", semana: "2026-09-01" }), TODAY);
    expect(empty.rows).toHaveLength(0);
    expect((await renderMetricsPdf(empty, "America/Sao_Paulo")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await testDb().auditLog.count({ where: { action: "EXPORT", entityId: "semanal" } })).toBe(2);

    const monthly = await buildMetricsReport(testDb(), sup, params({ tipo: "mensal", formato: "pdf", mes: "2026-10" }), TODAY);
    expect(monthly.rows[0]).toMatchObject({ tickets: 210, weeks: 2 });
    expect(metricsReportFileName(monthly, "pdf")).toBe("relatorio-mensal-2026-10.pdf");
    expect((await renderMetricsPdf(monthly, "America/Sao_Paulo")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(() => params({ tipo: "mensal", formato: "pdf", mes: "2026-13" })).toThrow();
  });

  it("ocorrências da folha: período do dia 20 ao 19, sem observações", async () => {
    expect(payrollPeriod(parseDateKey("2026-10-19"))).toEqual({ from: parseDateKey("2026-09-20"), to: parseDateKey("2026-10-19") });
    expect(payrollPeriod(parseDateKey("2026-10-20"))).toEqual({ from: parseDateKey("2026-10-20"), to: parseDateKey("2026-11-19") });
    expect(payrollPeriod(parseDateKey("2026-01-05"))).toEqual({ from: parseDateKey("2025-12-20"), to: parseDateKey("2026-01-19") });
    expect(previousPayrollPeriod(parseDateKey("2026-10-22"))).toEqual({ from: parseDateKey("2026-09-20"), to: parseDateKey("2026-10-19") });

    const sup = await createUser();
    const e = await makeEmployee(sup, { fullName: "Dora Lima" });
    const atestado = await occurrenceType("ATESTADO");
    const falta = await occurrenceType("FALTA");
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-09-19" });
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atestado.id, date: "2026-09-21", adminNotes: "Trânsito na ponte" });
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-10-19", restrictedNotes: "sigilo" });
    const r = await buildOccurrencesReport(testDb(), sup, params({ tipo: "folha", formato: "pdf", folha: "2026-10-01" }), TODAY);
    expect(r.total).toBe(2);
    expect(r.employees[0]).toMatchObject({ name: "Dora Lima", count: 2 });
    expect(JSON.stringify(r)).not.toMatch(/Trânsito|sigilo/);
    const text = occurrencesSummaryText(r);
    expect(text).toContain("Folha de 20/09/2026 a 19/10/2026");
    expect(text).toContain("Dora Lima");
    expect((await renderOccurrencesPdf(r, "America/Sao_Paulo")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await testDb().auditLog.count({ where: { action: "EXPORT", entityId: "folha" } })).toBe(1);
  });

  it("gera PDF válido, inclusive sem registros", async () => {
    const sup = await createUser();
    const report = await buildReport(testDb(), sup, params({ tipo: "reunioes", formato: "pdf" }), TODAY);
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
