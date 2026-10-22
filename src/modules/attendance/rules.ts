/**
 * Regras de jornada, escala e frequência — funções puras (sem banco), cobertas por testes.
 *
 * Modelo de tempo: um instante é representado em "minutos absolutos" =
 * dayNumber(data) * 1440 + minutos desde 00:00. Assim, um plantão 19:00–07:00 iniciado
 * em D vira o intervalo [D*1440+1140, D*1440+1860), atravessando a meia-noite sem
 * qualquer tratamento especial, e intervalos de dias diferentes podem ser unidos e
 * intersectados diretamente.
 *
 * Importante: estes cálculos são para acompanhamento gerencial. Não calculam descontos
 * salariais nem avaliam a validade jurídica de atestados.
 */
import { addDays, dayNumber, eachDay, MINUTES_PER_DAY, toDateKey, weekday } from "@/lib/dates";

export type Segment = { startMinute: number; endMinute: number };

export type ScheduleRule = {
  id: string;
  name: string;
  kind: "WEEKLY" | "ROTATION";
  weekdays: number[];
  cycleDays: number | null;
  workOffsets: number[];
  segments: Segment[];
};

export type AssignmentRule = {
  id: string;
  validFrom: Date;
  validTo: Date | null;
  cycleReferenceDate: Date | null;
  schedule: ScheduleRule;
};

export type AdjustmentRule = {
  id: string;
  date: Date;
  kind: "DAY_OFF" | "CUSTOM_HOURS";
  startMinute: number | null;
  endMinute: number | null;
  revokedAt: Date | null;
  reason?: string;
};

export type Interval = readonly [number, number];

export type DayPlan = {
  date: Date;
  dateKey: string;
  assignmentId: string | null;
  scheduleName: string | null;
  /** Escala prevista pela jornada vigente */
  planned: { isWorkDay: boolean; segments: Segment[] };
  /** Escala efetiva após trocas/ajustes */
  effective: { isWorkDay: boolean; segments: Segment[] };
  adjustment: AdjustmentRule | null;
};

// ───────────── Validação de jornadas ─────────────

export function validateSegments(segments: Segment[]): string | null {
  if (segments.length === 0) return "Informe ao menos um período de trabalho.";
  const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute);
  for (const s of sorted) {
    if (s.startMinute < 0 || s.startMinute >= MINUTES_PER_DAY) return "Horário de início inválido.";
    if (s.endMinute <= s.startMinute) return "O fim de cada período deve ser posterior ao início.";
    if (s.endMinute - s.startMinute > 24 * 60) return "Um período não pode exceder 24 horas.";
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinute < sorted[i - 1].endMinute) return "Os períodos da jornada não podem se sobrepor.";
  }
  const span = sorted[sorted.length - 1].endMinute - sorted[0].startMinute;
  if (span > 24 * 60) return "A jornada de um dia não pode ultrapassar 24 horas.";
  return null;
}

export function segmentMinutes(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.endMinute - s.startMinute), 0);
}

// ───────────── Vigência e escala ─────────────

export function isWithinValidity(a: Pick<AssignmentRule, "validFrom" | "validTo">, date: Date): boolean {
  const d = dayNumber(date);
  return d >= dayNumber(a.validFrom) && (a.validTo === null || d <= dayNumber(a.validTo));
}

export function findAssignment<T extends Pick<AssignmentRule, "validFrom" | "validTo">>(assignments: T[], date: Date): T | null {
  return assignments.find((a) => isWithinValidity(a, date)) ?? null;
}

/** Verifica sobreposição entre períodos de vigência (validTo nulo = sem fim). */
export function validityOverlaps(
  a: { validFrom: Date; validTo: Date | null },
  b: { validFrom: Date; validTo: Date | null },
): boolean {
  const aEnd = a.validTo ? dayNumber(a.validTo) : Number.POSITIVE_INFINITY;
  const bEnd = b.validTo ? dayNumber(b.validTo) : Number.POSITIVE_INFINITY;
  return dayNumber(a.validFrom) <= bEnd && dayNumber(b.validFrom) <= aEnd;
}

/** Posição da data no ciclo de revezamento (sempre entre 0 e cycleDays-1, inclusive antes da referência). */
export function cyclePosition(date: Date, reference: Date, cycleDays: number): number {
  const diff = dayNumber(date) - dayNumber(reference);
  return ((diff % cycleDays) + cycleDays) % cycleDays;
}

export function isPlannedWorkDay(assignment: Pick<AssignmentRule, "schedule" | "cycleReferenceDate">, date: Date): boolean {
  const s = assignment.schedule;
  if (s.kind === "WEEKLY") return s.weekdays.includes(weekday(date));
  if (!assignment.cycleReferenceDate || !s.cycleDays || s.cycleDays < 1) return false;
  return s.workOffsets.includes(cyclePosition(date, assignment.cycleReferenceDate, s.cycleDays));
}

export function planDay(assignments: AssignmentRule[], adjustments: AdjustmentRule[], date: Date): DayPlan {
  const assignment = findAssignment(assignments, date);
  const isWorkDay = assignment ? isPlannedWorkDay(assignment, date) : false;
  const plannedSegments = isWorkDay && assignment ? assignment.schedule.segments : [];
  const key = toDateKey(date);
  // O ajuste mais recente não revogado prevalece
  const adjustment =
    adjustments
      .filter((a) => a.revokedAt === null && toDateKey(a.date) === key)
      .at(-1) ?? null;

  let effective = { isWorkDay, segments: plannedSegments };
  if (adjustment?.kind === "DAY_OFF") effective = { isWorkDay: false, segments: [] };
  if (adjustment?.kind === "CUSTOM_HOURS" && adjustment.startMinute !== null && adjustment.endMinute !== null) {
    effective = { isWorkDay: true, segments: [{ startMinute: adjustment.startMinute, endMinute: adjustment.endMinute }] };
  }

  return {
    date,
    dateKey: key,
    assignmentId: assignment?.id ?? null,
    scheduleName: assignment?.schedule.name ?? null,
    planned: { isWorkDay, segments: plannedSegments },
    effective,
    adjustment,
  };
}

export function planRange(assignments: AssignmentRule[], adjustments: AdjustmentRule[], from: Date, to: Date): DayPlan[] {
  return eachDay(from, to).map((d) => planDay(assignments, adjustments, d));
}

// ───────────── Intervalos ─────────────

export function toAbsolute(date: Date, startMinute: number, endMinute: number): Interval {
  const base = dayNumber(date) * MINUTES_PER_DAY;
  return [base + startMinute, base + endMinute];
}

export function dayIntervals(plan: DayPlan, which: "planned" | "effective" = "effective"): Interval[] {
  return plan[which].segments.map((s) => toAbsolute(plan.date, s.startMinute, s.endMinute));
}

export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]);
    const e = Math.min(A[i][1], B[j][1]);
    if (e > s) out.push([s, e]);
    if (A[i][1] < B[j][1]) i++;
    else j++;
  }
  return out;
}

export function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  for (const [s0, e0] of A) {
    let s = s0;
    for (const [bs, be] of B) {
      if (be <= s || bs >= e0) continue;
      if (bs > s) out.push([s, bs]);
      s = Math.max(s, be);
      if (s >= e0) break;
    }
    if (s < e0) out.push([s, e0]);
  }
  return out;
}

export function totalMinutes(list: readonly Interval[]): number {
  return mergeIntervals(list).reduce((sum, [s, e]) => sum + (e - s), 0);
}

// ───────────── Frequência ─────────────

export type OccurrenceForCalc = {
  id: string;
  date: Date;
  startMinute: number | null;
  endMinute: number | null;
  countsAsAbsence: boolean;
  reviewStatus: "PENDING" | "CONFIRMED" | "DISREGARDED";
};

/**
 * Intervalo bruto da ocorrência: dia inteiro = todos os trechos efetivos do turno da
 * data; parcial = o intervalo informado (que pode atravessar a meia-noite).
 */
export function occurrenceRawIntervals(occ: OccurrenceForCalc, plan: DayPlan | undefined): Interval[] {
  if (occ.startMinute !== null && occ.endMinute !== null) return [toAbsolute(occ.date, occ.startMinute, occ.endMinute)];
  return plan ? dayIntervals(plan) : [];
}

export type AttendanceSummary = {
  plannedDays: number;
  offDays: number;
  adjustedDays: number;
  plannedMinutes: number;
  absenceMinutes: number;
  workedEstimateMinutes: number;
  /** Minutos efetivamente atribuídos a cada ocorrência, sem dupla contagem */
  minutesByOccurrence: Record<string, number>;
  /** Ocorrências de ausência sem interseção com a escala efetiva (ex.: registradas em folga) */
  outsideSchedule: string[];
};

/**
 * Consolida horas previstas e ausências no período [from, to].
 * - Horas previstas: soma dos trechos efetivos dos turnos iniciados no período.
 * - Ausência: união das ocorrências que descontam, intersectada com os trechos previstos
 *   (intervalos não computáveis — ex.: almoço — ficam naturalmente de fora).
 * - Cada minuto é contado uma única vez, mesmo com ocorrências sobrepostas.
 * - Ocorrências "desconsideradas" são ignoradas.
 */
export function summarizeAttendance(
  assignments: AssignmentRule[],
  adjustments: AdjustmentRule[],
  occurrences: OccurrenceForCalc[],
  from: Date,
  to: Date,
): AttendanceSummary {
  const plans = planRange(assignments, adjustments, from, to);
  const planByKey = new Map(plans.map((p) => [p.dateKey, p]));
  // Inclui o turno do dia anterior: uma ausência em D pode cobrir o fim de um plantão noturno de D-1.
  const previous = planDay(assignments, adjustments, addDays(from, -1));
  const scheduleInRange = plans.flatMap((p) => dayIntervals(p));
  const scheduleWithPrev = [...dayIntervals(previous), ...scheduleInRange];

  let plannedDays = 0;
  let offDays = 0;
  let adjustedDays = 0;
  for (const p of plans) {
    if (p.effective.isWorkDay) plannedDays++;
    else offDays++;
    if (p.adjustment) adjustedDays++;
  }
  const plannedMinutes = totalMinutes(scheduleInRange);

  const relevant = occurrences
    .filter((o) => o.countsAsAbsence && o.reviewStatus !== "DISREGARDED")
    .filter((o) => dayNumber(o.date) >= dayNumber(from) && dayNumber(o.date) <= dayNumber(to))
    .sort((a, b) => dayNumber(a.date) - dayNumber(b.date) || (a.startMinute ?? -1) - (b.startMinute ?? -1));

  let counted: Interval[] = [];
  const minutesByOccurrence: Record<string, number> = {};
  const outsideSchedule: string[] = [];
  for (const occ of relevant) {
    const raw = occurrenceRawIntervals(occ, planByKey.get(toDateKey(occ.date)));
    const effective = intersectIntervals(raw, scheduleInRange);
    if (effective.length === 0 && intersectIntervals(raw, scheduleWithPrev).length === 0) outsideSchedule.push(occ.id);
    const fresh = subtractIntervals(effective, counted);
    minutesByOccurrence[occ.id] = totalMinutes(fresh);
    counted = mergeIntervals([...counted, ...fresh]);
  }
  const absenceMinutes = totalMinutes(counted);

  return {
    plannedDays,
    offDays,
    adjustedDays,
    plannedMinutes,
    absenceMinutes,
    workedEstimateMinutes: Math.max(0, plannedMinutes - absenceMinutes),
    minutesByOccurrence,
    outsideSchedule,
  };
}

/** Jornadas padrão solicitadas, usadas na carga inicial (seed) do sistema. */
export const DEFAULT_SCHEDULES: Array<Omit<ScheduleRule, "id"> & { description: string }> = [
  {
    name: "Funcionário — 08:00–12:00 e 14:00–18:00",
    kind: "WEEKLY",
    weekdays: [1, 2, 3, 4, 5],
    cycleDays: null,
    workOffsets: [],
    segments: [
      { startMinute: 480, endMinute: 720 },
      { startMinute: 840, endMinute: 1080 },
    ],
    description: "Segunda a sexta, intervalo de 2h não computável.",
  },
  {
    name: "Estagiário manhã — 08:00–14:00",
    kind: "WEEKLY",
    weekdays: [1, 2, 3, 4, 5],
    cycleDays: null,
    workOffsets: [],
    segments: [{ startMinute: 480, endMinute: 840 }],
    description: "Segunda a sexta.",
  },
  {
    name: "Estagiário tarde — 12:00–18:00",
    kind: "WEEKLY",
    weekdays: [1, 2, 3, 4, 5],
    cycleDays: null,
    workOffsets: [],
    segments: [{ startMinute: 720, endMinute: 1080 }],
    description: "Segunda a sexta.",
  },
  {
    name: "Plantonista diurno 12x36 — 07:00–19:00",
    kind: "ROTATION",
    weekdays: [],
    cycleDays: 2,
    workOffsets: [0],
    segments: [{ startMinute: 420, endMinute: 1140 }],
    description: "12h de trabalho seguidas de 36h de descanso. Exige data de referência do ciclo.",
  },
  {
    name: "Plantonista noturno 12x36 — 19:00–07:00",
    kind: "ROTATION",
    weekdays: [],
    cycleDays: 2,
    workOffsets: [0],
    segments: [{ startMinute: 1140, endMinute: 1860 }],
    description: "Inicia às 19:00 e termina às 07:00 do dia seguinte. Exige data de referência do ciclo.",
  },
];

export const DEFAULT_OCCURRENCE_TYPES = [
  { code: "FALTA", name: "Falta", countsAsAbsence: true, requiresTimeRange: false, isMedical: false },
  { code: "ATESTADO", name: "Atestado", countsAsAbsence: true, requiresTimeRange: false, isMedical: true },
  { code: "ATRASO", name: "Atraso", countsAsAbsence: true, requiresTimeRange: true, isMedical: false },
  { code: "SAIDA_ANTECIPADA", name: "Saída antecipada", countsAsAbsence: true, requiresTimeRange: true, isMedical: false },
  { code: "AUSENCIA_PARCIAL", name: "Ausência parcial", countsAsAbsence: true, requiresTimeRange: true, isMedical: false },
  { code: "TROCA_PLANTAO", name: "Troca de plantão", countsAsAbsence: false, requiresTimeRange: false, isMedical: false },
  { code: "AJUSTE_ESCALA", name: "Ajuste de escala", countsAsAbsence: false, requiresTimeRange: false, isMedical: false },
] as const;
