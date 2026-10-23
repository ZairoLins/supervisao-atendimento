import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { parseDateKey } from "@/lib/dates";
import { createEmployee, inactivateEmployee, listEmployees, reactivateEmployee, updateEmployee } from "@/modules/employees/service";
import { combine, correctMetric, createMetric, fridayOf, getMetric, metricSeries, saveWeeklyBatch, weekStartOf, weeklyReportData, weeklySeries } from "@/modules/metrics/service";
import { createOccurrence } from "@/modules/attendance/occurrences";
import { createFeedback } from "@/modules/feedbacks/service";
import { createUser, disconnect, hasTestDb, resetDb, testDb } from "../support/db";
import { makeEmployee, occurrenceType } from "../support/factories";

describe.skipIf(!hasTestDb)("colaboradores", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("cadastra com identificador sequencial e registra auditoria", async () => {
    const sup = await createUser();
    const e = await createEmployee(testDb(), sup, { fullName: "  João da Silva ", jobTitle: "Atendente", team: "Central", startDate: "2024-03-01" });
    expect(e.code).toBe(1);
    expect(e.fullName).toBe("João da Silva");
    expect(e.searchText).toContain("joao da silva");
    expect(e.searchText).toContain("col-0001");
    expect(await testDb().auditLog.count({ where: { entityType: "Employee", entityId: e.id, action: "CREATE" } })).toBe(1);
  });

  it("valida campos obrigatórios e datas", async () => {
    const sup = await createUser();
    const err = await createEmployee(testDb(), sup, { fullName: "", jobTitle: "X", team: "Y", startDate: "2024-02-31" }).catch((e) => e);
    expect(err).toBeInstanceOf(ZodError);
    const fields = (err as ZodError).issues.map((i) => i.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["fullName", "startDate"]));
  });

  it("inativa sem excluir históricos e preserva vínculos por ID após renomear", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-09-15", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "9" }, parseDateKey("2026-10-23"));
    const falta = await occurrenceType("FALTA");
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-09-10" });
    await createFeedback(testDb(), sup, { employeeId: e.id, date: "2026-09-12", type: "ALIGNMENT", context: "Alinhamento de fila" });

    await updateEmployee(testDb(), sup, e.id, { fullName: "Nome Alterado", jobTitle: "Atendente", team: "Central", startDate: "2025-01-10" });
    await inactivateEmployee(testDb(), sup, e.id, { reason: "Desligamento" });

    const after = await testDb().employee.findUniqueOrThrow({
      where: { id: e.id },
      include: { metrics: true, occurrences: true, feedbacks: true },
    });
    expect(after.status).toBe("INACTIVE");
    expect(after.fullName).toBe("Nome Alterado");
    expect(after.metrics).toHaveLength(1);
    expect(after.occurrences).toHaveLength(1);
    expect(after.feedbacks).toHaveLength(1);

    // Não aparece na lista padrão, mas aparece filtrando inativos
    expect((await listEmployees(testDb(), sup, {})).total).toBe(0);
    expect((await listEmployees(testDb(), sup, { status: "INACTIVE" })).total).toBe(1);

    await expect(updateEmployee(testDb(), sup, e.id, { fullName: "X", jobTitle: "A", team: "B", startDate: "2025-01-10" })).rejects.toThrow(/Reative/);
    await reactivateEmployee(testDb(), sup, e.id);
    expect((await testDb().employee.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ACTIVE");
  });

  it("bloqueia escrita para perfil sem permissão", async () => {
    const asst = await createUser("ASSISTANT");
    await expect(createEmployee(testDb(), asst, { fullName: "A", jobTitle: "B", team: "C", startDate: "2024-01-01" })).rejects.toThrow(AppError);
  });
});

describe.skipIf(!hasTestDb)("métricas semanais", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  const TODAY = parseDateKey("2026-10-23"); // sexta-feira
  const base = (employeeId: string, over: Record<string, string> = {}) => ({
    employeeId,
    week: "2026-10-16",
    ticketsHandled: "320",
    avgHandleMinutes: "6,5",
    avgRating: "8.75",
    ...over,
  });

  it("normaliza a semana para a segunda-feira e impede duas vezes a mesma semana", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMetric(testDb(), sup, base(e.id), TODAY);
    expect(m.weekStart.toISOString().slice(0, 10)).toBe("2026-10-12");
    const err = await createMetric(testDb(), sup, base(e.id, { week: "2026-10-18", ticketsHandled: "1" }), TODAY).catch((x) => x);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("CONFLICT");
    await createMetric(testDb(), sup, base(e.id, { week: "2026-10-19" }), TODAY);
    expect(await testDb().weeklyMetric.count()).toBe(2);
    expect(weekStartOf(parseDateKey("2026-10-25")).toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(fridayOf(parseDateKey("2026-10-19")).toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("rejeita avaliação fora de 0 a 10, valores inválidos e semanas futuras", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    for (const avgRating of ["10.01", "-1", "11", "abc"]) {
      await expect(createMetric(testDb(), sup, base(e.id, { avgRating }), TODAY)).rejects.toBeInstanceOf(ZodError);
    }
    await expect(createMetric(testDb(), sup, base(e.id, { ticketsHandled: "-5" }), TODAY)).rejects.toBeInstanceOf(ZodError);
    await expect(createMetric(testDb(), sup, base(e.id, { avgRating: "8.123" }), TODAY)).rejects.toBeInstanceOf(ZodError);
    await expect(createMetric(testDb(), sup, base(e.id, { week: "2026-10-26" }), TODAY)).rejects.toThrow(/futuras/);
    expect(await createMetric(testDb(), sup, base(e.id, { avgRating: "10", week: "2026-10-22" }), TODAY)).toBeTruthy();
  });

  it("o banco impõe avaliação 0–10 e semana iniciando na segunda (CHECK)", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const data = { employeeId: e.id, ticketsHandled: 1, avgHandleMinutes: 1, avgRating: 5, jobTitleSnapshot: "x", teamSnapshot: "y" };
    await expect(testDb().weeklyMetric.create({ data: { ...data, weekStart: parseDateKey("2026-10-12"), avgRating: 12 } })).rejects.toThrow();
    await expect(testDb().weeklyMetric.create({ data: { ...data, weekStart: parseDateKey("2026-10-14") } })).rejects.toThrow();
  });

  it("lançamento da semana em lote: cria, ignora vazios, ajusta com histórico e valida por linha", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    const c = await makeEmployee(sup);
    const r1 = await saveWeeklyBatch(
      testDb(),
      sup,
      { week: "2026-10-23", [`t_${a.id}`]: "400", [`a_${a.id}`]: "5", [`r_${a.id}`]: "9", [`t_${b.id}`]: "200", [`a_${b.id}`]: "7,5", [`r_${b.id}`]: "8", [`t_${c.id}`]: "", [`a_${c.id}`]: "", [`r_${c.id}`]: "" },
      TODAY,
    );
    expect(r1).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(r1.weekStart.toISOString().slice(0, 10)).toBe("2026-10-19");

    const r2 = await saveWeeklyBatch(
      testDb(),
      sup,
      { week: "2026-10-19", [`t_${a.id}`]: "410", [`a_${a.id}`]: "5", [`r_${a.id}`]: "9", [`t_${b.id}`]: "200", [`a_${b.id}`]: "7.5", [`r_${b.id}`]: "8" },
      TODAY,
    );
    expect(r2).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const ma = await testDb().weeklyMetric.findFirstOrThrow({ where: { employeeId: a.id }, include: { revisions: true } });
    expect(ma.ticketsHandled).toBe(410);
    expect(ma.revisions.map((r) => r.ticketsHandled)).toEqual([400]);

    const err = await saveWeeklyBatch(testDb(), sup, { week: "2026-10-12", [`t_${c.id}`]: "10", [`r_${a.id}`]: "11", [`t_${a.id}`]: "1", [`a_${a.id}`]: "1" }, TODAY).catch((x) => x);
    expect(err).toBeInstanceOf(AppError);
    expect(err.fieldErrors).toHaveProperty(`a_${c.id}`);
    expect(err.fieldErrors).toHaveProperty(`r_${a.id}`);
    expect(await testDb().weeklyMetric.count({ where: { weekStart: parseDateKey("2026-10-12") } })).toBe(0);
    await expect(saveWeeklyBatch(testDb(), sup, { week: "2026-10-12" }, TODAY)).rejects.toThrow(/ao menos um/);
  });

  it("correção preserva valores originais em revisões, com motivo", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMetric(testDb(), sup, base(e.id), TODAY);
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "330", avgHandleMinutes: "6.5", avgRating: "8.75", reason: "Ajuste da fonte" });
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "Nova conferência" });
    const full = await getMetric(testDb(), sup, m.id);
    expect(full.ticketsHandled).toBe(331);
    expect(full.revisions).toHaveLength(2);
    expect(full.revisions[full.revisions.length - 1].ticketsHandled).toBe(320);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "x" })).rejects.toThrow(/Nenhum valor/);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "1", avgHandleMinutes: "1", avgRating: "1" })).rejects.toBeInstanceOf(ZodError);
  });

  it("semana conta no mês da sua sexta-feira; séries mensal e semanal", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    // Semana 27/07–02/08: sexta 31/07 → julho
    await createMetric(testDb(), sup, { employeeId: a.id, week: "2026-07-27", ticketsHandled: "50", avgHandleMinutes: "5", avgRating: "7" }, TODAY);
    // Semana 03/08: agosto
    await createMetric(testDb(), sup, { employeeId: a.id, week: "2026-08-03", ticketsHandled: "100", avgHandleMinutes: "4", avgRating: "8" }, TODAY);
    await createMetric(testDb(), sup, { employeeId: b.id, week: "2026-08-03", ticketsHandled: "300", avgHandleMinutes: "8", avgRating: "10" }, TODAY);
    // Semana 31/08–06/09: sexta 04/09 → setembro (mesmo começando em agosto)
    await createMetric(testDb(), sup, { employeeId: a.id, week: "2026-08-31", ticketsHandled: "10", avgHandleMinutes: "1", avgRating: "1" }, TODAY);
    const s = await metricSeries(testDb(), sup, { months: 3, end: parseDateKey("2026-09-01") });
    expect(s.map((p) => [p.month, p.tickets])).toEqual([["2026-07", 50], ["2026-08", 400], ["2026-09", 10]]);
    expect(s[1].aht).toBe(7);
    expect(s[1].rating).toBe(9.5);
    const w = await weeklySeries(testDb(), sup, { weeks: 3, end: parseDateKey("2026-08-05") });
    expect(w.map((p) => [p.month, p.tickets])).toEqual([["2026-07-20", null], ["2026-07-27", 50], ["2026-08-03", 400]]);
  });

  it("dados do relatório semanal comparam com a semana anterior", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup, { fullName: "Bia Souza" });
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-10-12", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "8" }, TODAY);
    await createMetric(testDb(), sup, { employeeId: e.id, week: "2026-10-19", ticketsHandled: "120", avgHandleMinutes: "4", avgRating: "9", notes: "Semana com campanha" }, TODAY);
    const r = await weeklyReportData(testDb(), sup, parseDateKey("2026-10-22"));
    expect(r.weekStart.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(r.rows[0]).toMatchObject({ name: "Bia Souza", tickets: 120, prev: { tickets: 100 } });
    expect(r.total.tickets).toBe(120);
    expect(r.previousTotal.tickets).toBe(100);
  });

  it("combine pondera tempo médio e avaliação pelo volume", () => {
    expect(combine([])).toEqual({ tickets: null, aht: null, rating: null, count: 0 });
    expect(combine([{ ticketsHandled: 0, avgHandleMinutes: 4, avgRating: 6 }, { ticketsHandled: 0, avgHandleMinutes: 6, avgRating: 8 }])).toMatchObject({ tickets: 0, aht: 5, rating: 7 });
  });
});
