/**
 * Utilitários de data puros.
 * Datas de calendário (sem horário) são representadas como Date em UTC 00:00 e como
 * "chaves" no formato AAAA-MM-DD. Horários são minutos desde 00:00 da data.
 */

const DAY_MS = 86_400_000;

export const MINUTES_PER_DAY = 1440;

export function parseDateKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Data inválida: ${key}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) throw new Error(`Data inválida: ${key}`);
  return d;
}

export function isValidDateKey(key: string): boolean {
  try {
    parseDateKey(key);
    return true;
  } catch {
    return false;
  }
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Número de dias desde 1970-01-01 (UTC) para uma data de calendário. */
export function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function fromDayNumber(n: number): Date {
  return new Date(n * DAY_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function monthKey(date: Date): string {
  return toDateKey(date).slice(0, 7);
}

export function parseMonthKey(key: string): Date {
  if (!/^\d{4}-\d{2}$/.test(key)) throw new Error(`Mês inválido: ${key}`);
  return parseDateKey(`${key}-01`);
}

/** Lista os meses (primeiro dia) entre dois meses, inclusive. */
export function monthRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let cur = startOfMonth(from);
  const end = startOfMonth(to);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) out.push(fromDayNumber(n));
  return out;
}

/** Dia da semana (0 = domingo) de uma data de calendário. */
export function weekday(date: Date): number {
  return date.getUTCDay();
}

/** Data de "hoje" no fuso da aplicação, como data de calendário UTC. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseDateKey(parts);
}

export function parseTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Horário inválido: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Horário inválido: ${value}`);
  return h * 60 + min;
}

export function isValidTime(value: string): boolean {
  try {
    parseTime(value);
    return true;
  } catch {
    return false;
  }
}

/** Formata minutos desde 00:00 como HH:MM (minutos >= 1440 representam o dia seguinte). */
export function formatTime(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatTimeRange(start: number, end: number): string {
  const suffix = end > MINUTES_PER_DAY ? " (+1)" : "";
  return `${formatTime(start)}–${formatTime(end)}${suffix}`;
}

/** Converte o par de horários do formulário em intervalo; fim <= início significa dia seguinte. */
export function timeRangeFromInputs(start: string, end: string): { startMinute: number; endMinute: number } {
  const s = parseTime(start);
  let e = parseTime(end);
  if (e <= s) e += MINUTES_PER_DAY;
  return { startMinute: s, endMinute: e };
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short", year: "numeric" });
const monthLongFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" });

/** Formata data de calendário (UTC 00:00) como DD/MM/AAAA. */
export function formatDate(date: Date | null | undefined): string {
  return date ? dateFmt.format(date) : "—";
}

export function formatMonth(date: Date): string {
  return monthFmt.format(date).replace(".", "").replace(" de ", "/");
}

export function formatMonthLong(date: Date): string {
  return monthLongFmt.format(date);
}

export function formatWeekday(date: Date): string {
  return weekdayFmt.format(date).replace(".", "");
}

/** Formata um instante (timestamp real) no fuso indicado. */
export function formatDateTime(date: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Deslocamento (ms) do fuso em relação ao UTC em um instante. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instant;
}

/** Instante real de uma data de calendário + minutos (horário local do fuso informado). */
export function zonedDateTimeToUtc(date: Date, minutes: number, timeZone: string): Date {
  const local = date.getTime() + minutes * 60_000;
  let utc = local - zoneOffsetMs(local, timeZone);
  utc = local - zoneOffsetMs(utc, timeZone);
  return new Date(utc);
}
