import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { parseDateKey as d, toDateKey } from "@/lib/dates";
import { assignSchedule, createAdjustment, createSchedule, revokeAdjustment, updateSchedule } from "@/modules/attendance/schedules";
import {
  addAttachment,
  createOccurrence,
  deleteOccurrence,
  employeeAttendanceSummary,
  employeeCalendar,
  getOccurrence,
  listOccurrences,
  readAttachment,
  updateOccurrence,
} from "@/modules/attendance/occurrences";
import { createUser, disconnect, hasTestDb, resetDb, testDb, withPermissions } from "../support/db";
import { makeEmployee, occurrenceType, scheduleByName } from "../support/factories";

describe.skipIf(!hasTestDb)("jornadas, escalas e ocorrências (banco)", () => {
  beforeEach(resetDb);
  afterAll(disconnect);

  it("12x36 exige data de referência e gera plantões alternados", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const dia = await scheduleByName("Plantonista diurno");
    await expect(assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: dia.id, validFrom: "2026-10-01" })).rejects.toThrow(/referência/);
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: dia.id, validFrom: "2026-10-01", cycleReferenceDate: "2026-10-02" });
    const cal = await employeeCalendar(testDb(), sup, e.id, d("2026-10-01"));
    const firstDays = cal.days.slice(0, 4).map((x) => x.effective.isWorkDay);
    expect(firstDays).toEqual([false, true, false, true]);
    expect(cal.summary.plannedMinutes).toBe(15 * 720);
  });

  it("nova atribuição encerra a anterior e preserva o histórico", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const manha = await scheduleByName("Estagiário manhã");
    const func = await scheduleByName("Funcionário");
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: manha.id, validFrom: "2026-01-01" });
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: func.id, validFrom: "2026-10-19" });
    const list = await testDb().employeeScheduleAssignment.findMany({ where: { employeeId: e.id }, orderBy: { validFrom: "asc" } });
    expect(list).toHaveLength(2);
    expect(toDateKey(list[0].validTo!)).toBe("2026-10-18");
    expect(list[1].validTo).toBeNull();
    // 16/10 (sexta) estagiário 6h + 19/10 (segunda) funcionário 8h
    const s = await employeeAttendanceSummary(testDb(), sup, e.id, d("2026-10-16"), d("2026-10-19"));
    expect(s.plannedMinutes).toBe(360 + 480);
    // Não permite vigência anterior a uma existente
    await expect(assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: manha.id, validFrom: "2026-05-01" })).rejects.toThrow(AppError);
  });

  it("não altera horários de jornada já atribuída (histórico preservado)", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const s = await createSchedule(testDb(), sup, { name: "Teste 6h", kind: "WEEKLY", weekdays: ["1", "2"], start1: "09:00", end1: "15:00" });
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: s.id, validFrom: "2026-01-01" });
    await updateSchedule(testDb(), sup, s.id, { name: "Teste 6h renomeada", kind: "WEEKLY", weekdays: ["1"], start1: "10:00", end1: "11:00", active: "on" });
    const after = await testDb().workSchedule.findUniqueOrThrow({ where: { id: s.id }, include: { segments: true } });
    expect(after.name).toBe("Teste 6h renomeada");
    expect(after.weekdays).toEqual([1, 2]);
    expect(after.segments[0].startMinute).toBe(540);
  });

  it("valida jornada com períodos sobrepostos", async () => {
    const sup = await createUser();
    await expect(createSchedule(testDb(), sup, { name: "Ruim", kind: "WEEKLY", weekdays: ["1"], start1: "08:00", end1: "12:00", start2: "11:00", end2: "13:00" })).rejects.toThrow(/sobrepor/);
  });

  it("plantão noturno: ausência parcial após a meia-noite é calculada", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const noite = await scheduleByName("Plantonista noturno");
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: noite.id, validFrom: "2026-10-01", cycleReferenceDate: "2026-10-01" });
    const parcial = await occurrenceType("AUSENCIA_PARCIAL");
    // Turno de 01/10 (19:00) — ausência de 03:00 a 07:00 do dia 02
    await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: parcial.id, date: "2026-10-01", startTime: "03:00", endTime: "07:00" });
    const s = await employeeAttendanceSummary(testDb(), sup, e.id, d("2026-10-01"), d("2026-10-01"));
    expect(s.plannedMinutes).toBe(720);
    expect(s.absenceMinutes).toBe(240);
  });

  it("exige horário para tipos parciais e impede ocorrência duplicada", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const atraso = await occurrenceType("ATRASO");
    await expect(createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19" })).rejects.toThrow(/exige horário/);
    const payload = { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", startTime: "08:00", endTime: "08:20" };
    await createOccurrence(testDb(), sup, payload);
    await expect(createOccurrence(testDb(), sup, payload)).rejects.toThrow(/mesmos dados/);
  });

  it("correção exige motivo e mantém auditoria com valores anteriores", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const atraso = await occurrenceType("ATRASO");
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", startTime: "08:00", endTime: "08:20", restrictedNotes: "Dado sigiloso" });
    const changed = { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", startTime: "08:00", endTime: "08:40" };
    await expect(updateOccurrence(testDb(), sup, o.id, changed)).rejects.toThrow();
    await updateOccurrence(testDb(), sup, o.id, { ...changed, reason: "Horário conferido no ponto" });
    const log = await testDb().auditLog.findFirstOrThrow({ where: { entityId: o.id, action: "CORRECT" } });
    expect(log.reason).toBe("Horário conferido no ponto");
    const changes = log.changes as Record<string, { from: unknown; to: unknown }>;
    expect(changes.endMinute).toEqual({ from: 500, to: 520 });
    // O conteúdo restrito nunca aparece na auditoria
    const allLogs = JSON.stringify(await testDb().auditLog.findMany());
    expect(allLogs).not.toContain("Dado sigiloso");
  });

  it("exclusão é lógica e exige motivo", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const falta = await occurrenceType("FALTA");
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: falta.id, date: "2026-10-19" });
    await expect(deleteOccurrence(testDb(), sup, o.id, {})).rejects.toThrow();
    await deleteOccurrence(testDb(), sup, o.id, { reason: "Lançado em duplicidade" });
    expect((await testDb().attendanceOccurrence.findUniqueOrThrow({ where: { id: o.id } })).deletedAt).not.toBeNull();
    expect((await listOccurrences(testDb(), sup, {})).total).toBe(0);
  });

  it("oculta observações restritas para quem não tem permissão", async () => {
    const sup = await createUser();
    const reader = withPermissions(await createUser("ASSISTANT", "leitor"), ["attendance:read"]);
    const e = await makeEmployee(sup);
    const atestado = await occurrenceType("ATESTADO");
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atestado.id, date: "2026-10-19", restrictedNotes: "CID confidencial" });
    const seen = await getOccurrence(testDb(), reader, o.id);
    expect(seen.restrictedNotes).toBeNull();
    expect(seen.hasRestricted).toBe(true);
    expect("attachments" in seen && Array.isArray(seen.attachments)).toBe(false);
    const list = await listOccurrences(testDb(), reader, {});
    expect(JSON.stringify(list)).not.toContain("CID confidencial");
    // Leitor não grava conteúdo restrito
    await expect(createOccurrence(testDb(), reader, { employeeId: e.id, typeId: atestado.id, date: "2026-10-20" })).rejects.toThrow(AppError);
  });

  it("anexos: valida o tipo real, grava em diretório privado e exige permissão para ler", async () => {
    const sup = await createUser();
    const reader = withPermissions(await createUser("ASSISTANT", "leitor2"), ["attendance:read"]);
    const e = await makeEmployee(sup);
    const atestado = await occurrenceType("ATESTADO");
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atestado.id, date: "2026-10-19" });
    const pdf = new TextEncoder().encode("%PDF-1.4\n% teste\n");
    const fake = new TextEncoder().encode("<script>alert(1)</script>");
    await expect(addAttachment(testDb(), sup, o.id, { name: "atestado.pdf", bytes: fake })).rejects.toThrow(/Formato não permitido/);
    await expect(addAttachment(testDb(), reader, o.id, { name: "a.pdf", bytes: pdf })).rejects.toThrow(AppError);
    const a = await addAttachment(testDb(), sup, o.id, { name: "../../etc/atestado.pdf", bytes: pdf });
    expect(a.originalName).toBe("atestado.pdf");
    expect(a.storedName).toMatch(/^[0-9a-f-]{36}\.bin$/);
    const read = await readAttachment(testDb(), sup, a.id);
    expect(Buffer.from(read.bytes).toString()).toContain("%PDF-1.4");
    await expect(readAttachment(testDb(), reader, a.id)).rejects.toThrow(AppError);
    expect(await testDb().auditLog.count({ where: { action: "VIEW_ATTACHMENT" } })).toBe(1);
  });

  it("troca de plantão cria ajuste espelhado sem apagar a escala prevista; revogação desfaz", async () => {
    const sup = await createUser();
    const a = await makeEmployee(sup);
    const b = await makeEmployee(sup);
    const dia = await scheduleByName("Plantonista diurno");
    await assignSchedule(testDb(), sup, { employeeId: a.id, scheduleId: dia.id, validFrom: "2026-10-01", cycleReferenceDate: "2026-10-01" });
    await assignSchedule(testDb(), sup, { employeeId: b.id, scheduleId: dia.id, validFrom: "2026-10-01", cycleReferenceDate: "2026-10-02" });
    const adj = await createAdjustment(testDb(), sup, { employeeId: a.id, date: "2026-10-01", kind: "DAY_OFF", swapWithEmployeeId: b.id, reason: "Compromisso" });

    const calA = await employeeCalendar(testDb(), sup, a.id, d("2026-10-01"));
    const calB = await employeeCalendar(testDb(), sup, b.id, d("2026-10-01"));
    expect(calA.days[0].planned.isWorkDay).toBe(true);
    expect(calA.days[0].effective.isWorkDay).toBe(false);
    expect(calB.days[0].planned.isWorkDay).toBe(false);
    expect(calB.days[0].effective.isWorkDay).toBe(true);
    expect(calB.days[0].effective.segments[0]).toEqual({ startMinute: 420, endMinute: 1140 });
    // Ocorrências de troca registradas para ambos
    expect(await testDb().attendanceOccurrence.count({ where: { type: { code: "TROCA_PLANTAO" } } })).toBe(2);

    await revokeAdjustment(testDb(), sup, adj.id, { reason: "Troca cancelada" });
    const calA2 = await employeeCalendar(testDb(), sup, a.id, d("2026-10-01"));
    const calB2 = await employeeCalendar(testDb(), sup, b.id, d("2026-10-01"));
    expect(calA2.days[0].effective.isWorkDay).toBe(true);
    expect(calB2.days[0].effective.isWorkDay).toBe(false);
    expect(await testDb().shiftAdjustment.count()).toBe(2);
  });
});
