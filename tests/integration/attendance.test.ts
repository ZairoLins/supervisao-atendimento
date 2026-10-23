import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { parseDateKey as d, toDateKey } from "@/lib/dates";
import { assignSchedule, createAdjustment, createSchedule, deleteAssignment, revokeAdjustment, updateSchedule } from "@/modules/attendance/schedules";
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

  it("exclui vigência lançada por engano e reabre a anterior", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const manha = await scheduleByName("Estagiário manhã");
    const func = await scheduleByName("Funcionário");
    const first = await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: manha.id, validFrom: "2026-01-01" });
    const wrong = await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: func.id, validFrom: "2026-10-19" });
    const r = await deleteAssignment(testDb(), sup, wrong.id);
    expect(r.reopened).toBe(true);
    const list = await testDb().employeeScheduleAssignment.findMany({ where: { employeeId: e.id } });
    expect(list.map((a) => a.id)).toEqual([first.id]);
    expect(list[0].validTo).toBeNull();
    expect(await testDb().auditLog.count({ where: { action: "DELETE_SCHEDULE" } })).toBe(1);
    // Excluir a única vigência deixa o colaborador sem jornada
    const r2 = await deleteAssignment(testDb(), sup, first.id);
    expect(r2.reopened).toBe(false);
    expect(await testDb().employeeScheduleAssignment.count({ where: { employeeId: e.id } })).toBe(0);
  });

  it("jornada com horário de sábado criada pelo formulário", async () => {
    const sup = await createUser();
    const s = await createSchedule(testDb(), sup, { name: "Seg–Sex + sábado", kind: "WEEKLY", weekdays: ["1", "2", "3", "4", "5"], start1: "09:00", end1: "18:00", satStart: "09:00", satEnd: "13:00" });
    const full = await testDb().workSchedule.findUniqueOrThrow({ where: { id: s.id }, include: { segments: true } });
    expect(full.weekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(full.segments.find((x) => x.weekday === 6)).toMatchObject({ startMinute: 540, endMinute: 780 });
    await expect(createSchedule(testDb(), sup, { name: "Ruim2", kind: "WEEKLY", weekdays: ["1"], start1: "09:00", end1: "18:00", satStart: "09:00" })).rejects.toThrow(/incompleto|horário específico/);
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

  it("atraso: informa só a chegada e o início vem da escala; impede duplicidade", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const atraso = await occurrenceType("ATRASO");
    expect(atraso.timeMode).toBe("ARRIVAL");
    // Sem jornada não há turno para completar o período
    await expect(createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", time: "08:20" })).rejects.toThrow(/Não há turno previsto/);
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: (await scheduleByName("Funcionário")).id, validFrom: "2026-01-01" });
    await expect(createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19" })).rejects.toThrow(/horário de chegada/);
    await expect(createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", time: "07:30" })).rejects.toThrow(/08:00–12:00 e 14:00–18:00/);
    const payload = { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", time: "08:20" };
    const o = await createOccurrence(testDb(), sup, payload);
    expect([o.startMinute, o.endMinute]).toEqual([480, 500]);
    await expect(createOccurrence(testDb(), sup, payload)).rejects.toThrow(/mesmos dados/);
    const s = await employeeAttendanceSummary(testDb(), sup, e.id, d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(20);
  });

  it("saída antecipada: informa só a saída e o fim vem da escala (inclusive após a meia-noite)", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    const saida = await occurrenceType("SAIDA_ANTECIPADA");
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: (await scheduleByName("Funcionário")).id, validFrom: "2026-01-01" });
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: saida.id, date: "2026-10-19", time: "16:30" });
    expect([o.startMinute, o.endMinute]).toEqual([990, 1080]);
    const s = await employeeAttendanceSummary(testDb(), sup, e.id, d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(90);

    const n = await makeEmployee(sup);
    await assignSchedule(testDb(), sup, { employeeId: n.id, scheduleId: (await scheduleByName("Plantonista noturno")).id, validFrom: "2026-10-01", cycleReferenceDate: "2026-10-01" });
    const o2 = await createOccurrence(testDb(), sup, { employeeId: n.id, typeId: saida.id, date: "2026-10-01", time: "04:00" });
    expect([o2.startMinute, o2.endMinute]).toEqual([1680, 1860]);
    await expect(createOccurrence(testDb(), sup, { employeeId: n.id, typeId: saida.id, date: "2026-10-02", time: "04:00" })).rejects.toThrow(/Não há turno previsto/);
  });

  it("correção exige motivo e mantém auditoria com valores anteriores", async () => {
    const sup = await createUser();
    const e = await makeEmployee(sup);
    await assignSchedule(testDb(), sup, { employeeId: e.id, scheduleId: (await scheduleByName("Funcionário")).id, validFrom: "2026-01-01" });
    const atraso = await occurrenceType("ATRASO");
    const o = await createOccurrence(testDb(), sup, { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", time: "08:20", restrictedNotes: "Dado sigiloso" });
    const changed = { employeeId: e.id, typeId: atraso.id, date: "2026-10-19", time: "08:40" };
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
