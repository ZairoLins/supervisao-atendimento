import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { parseDateKey } from "@/lib/dates";
import { createEmployee, inactivateEmployee, listEmployees, reactivateEmployee, updateEmployee } from "@/modules/employees/service";
import { combine, correctMetric, createMetric, dailySeries, getMetric, metricSeries, saveDailyBatch } from "@/modules/metrics/service";
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
    await createMetric(testDb(), sup, { employeeId: e.id, date: "2026-09-15", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "9" }, parseDateKey("2026-10-23"));
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

describe.skipIf(!hasTestDb)("métricas diárias", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  const TODAY = parseDateKey("2026-10-23");
  const base = (employeeId: string, over: Record<string, string> = {}) => ({
    employeeId,
    date: "2026-10-20",
    ticketsHandled: "32",
    avgHandleMinutes: "6,5",
    avgRating: "8.75",
    ...over,
  });

  it("impede dois lançamentos do mesmo colaborador no mesmo dia", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await createMetric(testDb(), sup, base(e.id), TODAY);
    const err = await createMetric(testDb(), sup, base(e.id, { ticketsHandled: "1" }), TODAY).catch((x) => x);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("CONFLICT");
    expect(await testDb().dailyMetric.count()).toBe(1);
    // Outro dia é permitido
    await createMetric(testDb(), sup, base(e.id, { date: "2026-10-21" }), TODAY);
    expect(await testDb().dailyMetric.count()).toBe(2);
  });

  it("rejeita avaliação fora de 0 a 10, valores inválidos e datas futuras", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    for (const avgRating of ["10.01", "-1", "11", "abc"]) {
      await expect(createMetric(testDb(), sup, base(e.id, { avgRating }), TODAY)).rejects.toBeInstanceOf(ZodError);
    }
    await expect(createMetric(testDb(), sup, base(e.id, { ticketsHandled: "-5" }), TODAY)).rejects.toBeInstanceOf(ZodError);
    await expect(createMetric(testDb(), sup, base(e.id, { avgRating: "8.123" }), TODAY)).rejects.toBeInstanceOf(ZodError);
    await expect(createMetric(testDb(), sup, base(e.id, { date: "2026-10-24" }), TODAY)).rejects.toThrow(/futuras/);
    expect(await createMetric(testDb(), sup, base(e.id, { avgRating: "10" }), TODAY)).toBeTruthy();
  });

  it("o banco também impõe a faixa da avaliação (CHECK)", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await expect(
      testDb().dailyMetric.create({
        data: { employeeId: e.id, date: parseDateKey("2026-10-01"), ticketsHandled: 1, avgHandleMinutes: 1, avgRating: 12, jobTitleSnapshot: "x", teamSnapshot: "y" },
      }),
    ).rejects.toThrow();
  });

  it("lançamento do dia em lote: cria, ignora linhas vazias, ajusta com histórico e valida por linha", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    const c = await makeEmployee(sup);
    const r1 = await saveDailyBatch(
      testDb(),
      sup,
      { date: "2026-10-22", [`t_${a.id}`]: "40", [`a_${a.id}`]: "5", [`r_${a.id}`]: "9", [`t_${b.id}`]: "20", [`a_${b.id}`]: "7,5", [`r_${b.id}`]: "8", [`t_${c.id}`]: "", [`a_${c.id}`]: "", [`r_${c.id}`]: "" },
      TODAY,
    );
    expect(r1).toEqual({ created: 2, updated: 0, unchanged: 0 });

    // Reenvio com um valor alterado: gera revisão preservando o original
    const r2 = await saveDailyBatch(
      testDb(),
      sup,
      { date: "2026-10-22", [`t_${a.id}`]: "41", [`a_${a.id}`]: "5", [`r_${a.id}`]: "9", [`t_${b.id}`]: "20", [`a_${b.id}`]: "7.5", [`r_${b.id}`]: "8" },
      TODAY,
    );
    expect(r2).toEqual({ created: 0, updated: 1, unchanged: 1 });
    const ma = await testDb().dailyMetric.findFirstOrThrow({ where: { employeeId: a.id }, include: { revisions: true } });
    expect(ma.ticketsHandled).toBe(41);
    expect(ma.revisions.map((r) => r.ticketsHandled)).toEqual([40]);

    // Linha incompleta e avaliação inválida: erros por célula, nada é gravado
    const err = await saveDailyBatch(testDb(), sup, { date: "2026-10-21", [`t_${c.id}`]: "10", [`r_${a.id}`]: "11", [`t_${a.id}`]: "1", [`a_${a.id}`]: "1" }, TODAY).catch((x) => x);
    expect(err).toBeInstanceOf(AppError);
    expect(err.fieldErrors).toHaveProperty(`a_${c.id}`);
    expect(err.fieldErrors).toHaveProperty(`r_${a.id}`);
    expect(await testDb().dailyMetric.count({ where: { date: parseDateKey("2026-10-21") } })).toBe(0);

    await expect(saveDailyBatch(testDb(), sup, { date: "2026-10-21" }, TODAY)).rejects.toThrow(/ao menos um/);
  });

  it("correção preserva valores originais em revisões, com motivo", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMetric(testDb(), sup, base(e.id, { ticketsHandled: "320" }), TODAY);
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "330", avgHandleMinutes: "6.5", avgRating: "8.75", reason: "Ajuste da fonte" });
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "Nova conferência" });
    const full = await getMetric(testDb(), sup, m.id);
    expect(full.ticketsHandled).toBe(331);
    expect(full.revisions).toHaveLength(2);
    expect(full.revisions[full.revisions.length - 1].ticketsHandled).toBe(320);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "x" })).rejects.toThrow(/Nenhum valor/);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "1", avgHandleMinutes: "1", avgRating: "1" })).rejects.toBeInstanceOf(ZodError);
  });

  it("agrega dias em meses (meses vazios nulos) e monta a série diária", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    await createMetric(testDb(), sup, { employeeId: a.id, date: "2026-08-03", ticketsHandled: "100", avgHandleMinutes: "4", avgRating: "8" }, TODAY);
    await createMetric(testDb(), sup, { employeeId: b.id, date: "2026-08-04", ticketsHandled: "300", avgHandleMinutes: "8", avgRating: "10" }, TODAY);
    await createMetric(testDb(), sup, { employeeId: a.id, date: "2026-06-10", ticketsHandled: "50", avgHandleMinutes: "5", avgRating: "7" }, TODAY);
    const s = await metricSeries(testDb(), sup, { months: 3, end: parseDateKey("2026-08-01") });
    expect(s.map((p) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(s[1].tickets).toBeNull();
    expect(s[2].tickets).toBe(400);
    expect(s[2].aht).toBe(7); // (100*4 + 300*8) / 400
    expect(s[2].rating).toBe(9.5); // (100*8 + 300*10) / 400
    const d = await dailySeries(testDb(), sup, { month: parseDateKey("2026-08-01") });
    expect(d).toHaveLength(31);
    expect(d[2]).toMatchObject({ month: "2026-08-03", tickets: 100 });
    expect(d[0].tickets).toBeNull();
    const ind = await dailySeries(testDb(), sup, { month: parseDateKey("2026-08-01"), employeeId: b.id });
    expect(ind.filter((x) => x.tickets !== null)).toHaveLength(1);
  });

  it("combine pondera tempo médio e avaliação pelo volume", () => {
    expect(combine([])).toEqual({ tickets: null, aht: null, rating: null, count: 0 });
    expect(combine([{ ticketsHandled: 0, avgHandleMinutes: 4, avgRating: 6 }, { ticketsHandled: 0, avgHandleMinutes: 6, avgRating: 8 }])).toMatchObject({ tickets: 0, aht: 5, rating: 7 });
  });
});
