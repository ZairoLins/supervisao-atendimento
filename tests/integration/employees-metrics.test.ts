import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { parseDateKey } from "@/lib/dates";
import { createEmployee, inactivateEmployee, listEmployees, reactivateEmployee, updateEmployee } from "@/modules/employees/service";
import { correctMetric, createMetric, getMetric, metricSeries } from "@/modules/metrics/service";
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
    await createMetric(testDb(), sup, { employeeId: e.id, month: "2026-09", ticketsHandled: "100", avgHandleMinutes: "5", avgRating: "9" });
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

describe.skipIf(!hasTestDb)("métricas mensais", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  const base = (employeeId: string, over: Record<string, string> = {}) => ({
    employeeId,
    month: "2026-08",
    ticketsHandled: "320",
    avgHandleMinutes: "6,5",
    avgRating: "8.75",
    ...over,
  });

  it("impede duplicidade para o mesmo colaborador e mês", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await createMetric(testDb(), sup, base(e.id));
    const err = await createMetric(testDb(), sup, base(e.id, { ticketsHandled: "1" })).catch((x) => x);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("CONFLICT");
    expect(await testDb().monthlyMetric.count()).toBe(1);
  });

  it("rejeita avaliação fora de 0 a 10 e valores inválidos", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    for (const avgRating of ["10.01", "-1", "11", "abc"]) {
      await expect(createMetric(testDb(), sup, base(e.id, { avgRating }))).rejects.toBeInstanceOf(ZodError);
    }
    await expect(createMetric(testDb(), sup, base(e.id, { ticketsHandled: "-5" }))).rejects.toBeInstanceOf(ZodError);
    await expect(createMetric(testDb(), sup, base(e.id, { avgRating: "8.123" }))).rejects.toBeInstanceOf(ZodError);
    expect(await createMetric(testDb(), sup, base(e.id, { avgRating: "10" }))).toBeTruthy();
  });

  it("o banco também impõe a faixa da avaliação (CHECK)", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await expect(
      testDb().monthlyMetric.create({
        data: { employeeId: e.id, month: parseDateKey("2026-07-01"), ticketsHandled: 1, avgHandleMinutes: 1, avgRating: 12, jobTitleSnapshot: "x", teamSnapshot: "y" },
      }),
    ).rejects.toThrow();
  });

  it("correção preserva valores originais em revisões, com motivo", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const m = await createMetric(testDb(), sup, base(e.id));
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "330", avgHandleMinutes: "6.5", avgRating: "8.75", reason: "Ajuste da fonte" });
    await correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "Nova conferência" });
    const full = await getMetric(testDb(), sup, m.id);
    expect(full.ticketsHandled).toBe(331);
    expect(full.revisions).toHaveLength(2);
    const original = full.revisions[full.revisions.length - 1];
    expect(original.ticketsHandled).toBe(320);
    expect(Number(original.avgHandleMinutes)).toBe(6.5);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "331", avgHandleMinutes: "6.4", avgRating: "8.8", reason: "x" })).rejects.toThrow(/Nenhum valor/);
    await expect(correctMetric(testDb(), sup, m.id, { ticketsHandled: "1", avgHandleMinutes: "1", avgRating: "1" })).rejects.toBeInstanceOf(ZodError);
  });

  it("série histórica mostra meses sem registro como nulos e agrega a equipe", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    await createMetric(testDb(), sup, { employeeId: a.id, month: "2026-08", ticketsHandled: "100", avgHandleMinutes: "4", avgRating: "8" });
    await createMetric(testDb(), sup, { employeeId: b.id, month: "2026-08", ticketsHandled: "300", avgHandleMinutes: "8", avgRating: "10" });
    await createMetric(testDb(), sup, { employeeId: a.id, month: "2026-06", ticketsHandled: "50", avgHandleMinutes: "5", avgRating: "7" });
    const s = await metricSeries(testDb(), sup, { months: 3, end: parseDateKey("2026-08-01") });
    expect(s.map((p) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(s[1].tickets).toBeNull();
    expect(s[2].tickets).toBe(400);
    expect(s[2].aht).toBe(7); // (100*4 + 300*8) / 400
    expect(s[2].rating).toBe(9);
    const ind = await metricSeries(testDb(), sup, { months: 3, end: parseDateKey("2026-08-01"), employeeId: a.id });
    expect(ind[2].tickets).toBe(100);
  });
});
