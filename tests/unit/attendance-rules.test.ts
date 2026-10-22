import { describe, expect, it } from "vitest";
import { parseDateKey as d } from "@/lib/dates";
import {
  cyclePosition,
  DEFAULT_SCHEDULES,
  intersectIntervals,
  isPlannedWorkDay,
  mergeIntervals,
  planDay,
  planRange,
  subtractIntervals,
  summarizeAttendance,
  validateSegments,
  validityOverlaps,
  type AdjustmentRule,
  type AssignmentRule,
  type OccurrenceForCalc,
} from "@/modules/attendance/rules";

const [FUNC, EST_MANHA, EST_TARDE, PLANT_DIA, PLANT_NOITE] = DEFAULT_SCHEDULES.map((s, i) => ({ ...s, id: `s${i}` }));

function assign(schedule: AssignmentRule["schedule"], from: string, to: string | null = null, ref: string | null = null): AssignmentRule {
  return { id: `a-${schedule.id}-${from}`, validFrom: d(from), validTo: to ? d(to) : null, cycleReferenceDate: ref ? d(ref) : null, schedule };
}

function occ(id: string, date: string, start: number | null = null, end: number | null = null, extra: Partial<OccurrenceForCalc> = {}): OccurrenceForCalc {
  return { id, date: d(date), startMinute: start, endMinute: end, countsAsAbsence: true, reviewStatus: "PENDING", ...extra };
}

describe("jornadas padrão", () => {
  it("funcionário prevê 8h com intervalo de almoço não computável", () => {
    // 2026-10-19 é segunda-feira
    const s = summarizeAttendance([assign(FUNC, "2026-01-01")], [], [], d("2026-10-19"), d("2026-10-19"));
    expect(s.plannedMinutes).toBe(480);
    expect(s.plannedDays).toBe(1);
  });

  it("funcionário não trabalha no fim de semana", () => {
    const s = summarizeAttendance([assign(FUNC, "2026-01-01")], [], [], d("2026-10-17"), d("2026-10-18"));
    expect(s.plannedMinutes).toBe(0);
    expect(s.offDays).toBe(2);
  });

  it("estagiários de manhã e de tarde preveem 6h", () => {
    expect(summarizeAttendance([assign(EST_MANHA, "2026-01-01")], [], [], d("2026-10-19"), d("2026-10-19")).plannedMinutes).toBe(360);
    expect(summarizeAttendance([assign(EST_TARDE, "2026-01-01")], [], [], d("2026-10-19"), d("2026-10-19")).plannedMinutes).toBe(360);
  });

  it("valida trechos sobrepostos e inválidos", () => {
    expect(validateSegments([{ startMinute: 480, endMinute: 720 }, { startMinute: 700, endMinute: 900 }])).toMatch(/sobrepor/);
    expect(validateSegments([{ startMinute: 600, endMinute: 600 }])).toMatch(/posterior/);
    expect(validateSegments([])).toMatch(/ao menos/);
    expect(validateSegments(PLANT_NOITE.segments)).toBeNull();
  });
});

describe("escala 12x36", () => {
  const ref = "2026-10-01";
  const a = assign(PLANT_DIA, "2026-09-01", null, ref);

  it("alterna plantão e folga a partir da data de referência", () => {
    const days = planRange([a], [], d("2026-10-01"), d("2026-10-06")).map((p) => p.effective.isWorkDay);
    expect(days).toEqual([true, false, true, false, true, false]);
  });

  it("calcula corretamente datas anteriores à referência", () => {
    expect(cyclePosition(d("2026-09-30"), d(ref), 2)).toBe(1);
    expect(cyclePosition(d("2026-09-29"), d(ref), 2)).toBe(0);
    expect(isPlannedWorkDay(a, d("2026-09-29"))).toBe(true);
  });

  it("prevê 12h por plantão e 36h de descanso entre plantões diurnos", () => {
    const s = summarizeAttendance([a], [], [], d("2026-10-01"), d("2026-10-31"));
    expect(s.plannedDays).toBe(16);
    expect(s.plannedMinutes).toBe(16 * 720);
  });

  it("sem data de referência não gera plantões", () => {
    expect(isPlannedWorkDay(assign(PLANT_DIA, "2026-09-01"), d("2026-10-01"))).toBe(false);
  });
});

describe("plantão noturno atravessando a meia-noite", () => {
  const a = assign(PLANT_NOITE, "2026-09-01", null, "2026-10-01");

  it("conta 12h para o plantão iniciado às 19:00", () => {
    const s = summarizeAttendance([a], [], [], d("2026-10-01"), d("2026-10-01"));
    expect(s.plannedMinutes).toBe(720);
  });

  it("falta de dia inteiro desconta o plantão completo, inclusive após a meia-noite", () => {
    const s = summarizeAttendance([a], [], [occ("f1", "2026-10-01")], d("2026-10-01"), d("2026-10-02"));
    expect(s.absenceMinutes).toBe(720);
    expect(s.workedEstimateMinutes).toBe(0);
  });

  it("ausência parcial 02:00–07:00 do turno (fim no dia seguinte) é calculada", () => {
    // 02:00 do dia seguinte = 1440 + 120 = 1560; 07:00 = 1860
    const s = summarizeAttendance([a], [], [occ("p1", "2026-10-01", 1560, 1860)], d("2026-10-01"), d("2026-10-01"));
    expect(s.absenceMinutes).toBe(300);
  });

  it("saída antecipada 23:00–07:00 desconta 8h", () => {
    const s = summarizeAttendance([a], [], [occ("s1", "2026-10-01", 1380, 1860)], d("2026-10-01"), d("2026-10-01"));
    expect(s.absenceMinutes).toBe(480);
  });
});

describe("cálculo de ausências", () => {
  const a = assign(FUNC, "2026-01-01");

  it("ausência parcial no intervalo de almoço não é contabilizada", () => {
    const s = summarizeAttendance([a], [], [occ("x", "2026-10-19", 720, 840)], d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(0);
    expect(s.outsideSchedule).toEqual(["x"]);
  });

  it("ausência parcial 11:00–15:00 conta somente 2h (exclui o almoço)", () => {
    const s = summarizeAttendance([a], [], [occ("x", "2026-10-19", 660, 900)], d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(120);
  });

  it("atraso de 25 minutos", () => {
    const s = summarizeAttendance([a], [], [occ("t", "2026-10-19", 480, 505)], d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(25);
    expect(s.workedEstimateMinutes).toBe(455);
  });

  it("não contabiliza o mesmo intervalo duas vezes", () => {
    const s = summarizeAttendance(
      [a],
      [],
      [occ("full", "2026-10-19"), occ("late", "2026-10-19", 480, 540), occ("partial", "2026-10-19", 600, 700)],
      d("2026-10-19"),
      d("2026-10-19"),
    );
    expect(s.absenceMinutes).toBe(480);
    const sum = Object.values(s.minutesByOccurrence).reduce((x, y) => x + y, 0);
    expect(sum).toBe(480);
  });

  it("ignora ocorrências desconsideradas e as que não descontam horas", () => {
    const s = summarizeAttendance(
      [a],
      [],
      [occ("d", "2026-10-19", null, null, { reviewStatus: "DISREGARDED" }), occ("swap", "2026-10-19", null, null, { countsAsAbsence: false })],
      d("2026-10-19"),
      d("2026-10-19"),
    );
    expect(s.absenceMinutes).toBe(0);
  });

  it("falta em dia de folga não desconta e é sinalizada", () => {
    const s = summarizeAttendance([a], [], [occ("w", "2026-10-18")], d("2026-10-18"), d("2026-10-18"));
    expect(s.absenceMinutes).toBe(0);
    expect(s.outsideSchedule).toEqual(["w"]);
  });

  it("ocorrências fora do período não entram", () => {
    const s = summarizeAttendance([a], [], [occ("o", "2026-10-20")], d("2026-10-19"), d("2026-10-19"));
    expect(s.absenceMinutes).toBe(0);
  });
});

describe("histórico de vigência", () => {
  it("usa a jornada vigente em cada data", () => {
    const hist = [assign(EST_MANHA, "2026-01-01", "2026-10-18"), assign(FUNC, "2026-10-19")];
    expect(planDay(hist, [], d("2026-10-16")).planned.segments).toEqual(EST_MANHA.segments);
    expect(planDay(hist, [], d("2026-10-19")).planned.segments).toEqual(FUNC.segments);
    const s = summarizeAttendance(hist, [], [], d("2026-10-16"), d("2026-10-19"));
    expect(s.plannedMinutes).toBe(360 + 480);
  });

  it("detecta sobreposição de vigências", () => {
    expect(validityOverlaps({ validFrom: d("2026-01-01"), validTo: null }, { validFrom: d("2026-05-01"), validTo: d("2026-06-01") })).toBe(true);
    expect(validityOverlaps({ validFrom: d("2026-01-01"), validTo: d("2026-04-30") }, { validFrom: d("2026-05-01"), validTo: null })).toBe(false);
  });

  it("sem atribuição o dia não tem horas previstas", () => {
    const s = summarizeAttendance([assign(FUNC, "2026-11-01")], [], [], d("2026-10-19"), d("2026-10-19"));
    expect(s.plannedMinutes).toBe(0);
  });
});

describe("trocas e ajustes de escala", () => {
  const a = assign(PLANT_DIA, "2026-09-01", null, "2026-10-01");
  const adj = (date: string, kind: AdjustmentRule["kind"], s: number | null = null, e: number | null = null, revoked = false): AdjustmentRule => ({
    id: `${date}-${kind}`,
    date: d(date),
    kind,
    startMinute: s,
    endMinute: e,
    revokedAt: revoked ? new Date() : null,
  });

  it("preserva a escala prevista e aplica o ajuste na efetiva", () => {
    const p = planDay([a], [adj("2026-10-01", "DAY_OFF"), adj("2026-10-02", "CUSTOM_HOURS", 420, 1140)], d("2026-10-01"));
    expect(p.planned.isWorkDay).toBe(true);
    expect(p.effective.isWorkDay).toBe(false);
    const p2 = planDay([a], [adj("2026-10-02", "CUSTOM_HOURS", 420, 1140)], d("2026-10-02"));
    expect(p2.planned.isWorkDay).toBe(false);
    expect(p2.effective.isWorkDay).toBe(true);
  });

  it("troca de plantão mantém o total de horas", () => {
    const s = summarizeAttendance(
      [a],
      [adj("2026-10-01", "DAY_OFF"), adj("2026-10-02", "CUSTOM_HOURS", 420, 1140)],
      [],
      d("2026-10-01"),
      d("2026-10-02"),
    );
    expect(s.plannedMinutes).toBe(720);
    expect(s.adjustedDays).toBe(2);
  });

  it("ajuste revogado não altera a escala", () => {
    const p = planDay([a], [adj("2026-10-01", "DAY_OFF", null, null, true)], d("2026-10-01"));
    expect(p.effective.isWorkDay).toBe(true);
  });
});

describe("operações de intervalos", () => {
  it("une, intersecta e subtrai", () => {
    expect(mergeIntervals([[0, 10], [5, 20], [30, 40]])).toEqual([[0, 20], [30, 40]]);
    expect(intersectIntervals([[0, 20]], [[10, 30]])).toEqual([[10, 20]]);
    expect(subtractIntervals([[0, 100]], [[10, 20], [50, 60]])).toEqual([[0, 10], [20, 50], [60, 100]]);
  });
});
