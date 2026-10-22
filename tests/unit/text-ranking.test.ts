import { describe, expect, it } from "vitest";
import { buildSearchText, formatCode, highlightSegments, normalizeQuery, normalizeText, parseCodeQuery } from "@/lib/text";
import { parseMonthQuery, scoreMatch } from "@/modules/search/ranking";
import { alignToShift } from "@/modules/attendance/occurrences";
import { formatTimeRange, parseDateKey, timeRangeFromInputs, todayInTimeZone } from "@/lib/dates";
import { diff, redact } from "@/lib/audit";

describe("normalização de texto", () => {
  it("remove acentos, maiúsculas e espaços extras", () => {
    expect(normalizeText("  JOÃO   Conceição ")).toBe("joao conceicao");
    expect(buildSearchText("COL-0001", "Ana", null, undefined, "")).toBe("col-0001 ana");
  });

  it("neutraliza curingas de LIKE no termo", () => {
    expect(normalizeQuery("50% _x\\y")).toBe("50 x y");
    expect(normalizeQuery("%%")).toBe("");
  });

  it("reconhece identificadores", () => {
    expect(parseCodeQuery("TAR-12")).toEqual({ entity: "task", code: 12 });
    expect(parseCodeQuery("col 0003")).toEqual({ entity: "employee", code: 3 });
    expect(parseCodeQuery("#7")).toEqual({ entity: null, code: 7 });
    expect(parseCodeQuery("XYZ-1")).toBeNull();
    expect(parseCodeQuery("ana")).toBeNull();
    expect(formatCode("meeting", 5)).toBe("REU-0005");
  });

  it("destaca o termo preservando o texto original e acentos", () => {
    expect(highlightSegments("Conceição Ana", "conceicao")).toEqual([
      { text: "Conceição", match: true },
      { text: " Ana", match: false },
    ]);
    expect(highlightSegments("abc", "")).toEqual([{ text: "abc", match: false }]);
  });
});

describe("relevância", () => {
  it("ordena exato > início > início de palavra > parcial", () => {
    const q = "ana";
    const exact = scoreMatch("Ana", q);
    const prefix = scoreMatch("Ana Beatriz", q);
    const word = scoreMatch("Maria Ana", q);
    const partial = scoreMatch("Joana", q);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(partial);
    expect(scoreMatch("qualquer", q, { codeMatch: true })).toBeGreaterThanOrEqual(1000);
  });

  it("não quebra com caracteres de expressão regular", () => {
    expect(() => scoreMatch("a(b", "(b")).not.toThrow();
    expect(scoreMatch("a(b", "(b")).toBeGreaterThan(10);
  });

  it("interpreta meses", () => {
    expect(parseMonthQuery("10/2026")?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(parseMonthQuery("out/2026")?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(parseMonthQuery("2026-03")?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(parseMonthQuery("13/2026")).toBeNull();
  });
});

describe("horários e fuso", () => {
  it("fim menor que início indica dia seguinte", () => {
    expect(timeRangeFromInputs("19:00", "07:00")).toEqual({ startMinute: 1140, endMinute: 1860 });
    expect(formatTimeRange(1140, 1860)).toBe("19:00–07:00 (+1)");
  });

  it("alinha horários após a meia-noite ao plantão noturno", () => {
    const plan = { effective: { isWorkDay: true, segments: [{ startMinute: 1140, endMinute: 1860 }] } };
    expect(alignToShift({ startMinute: 180, endMinute: 420 }, plan)).toEqual({ startMinute: 1620, endMinute: 1860 });
    expect(alignToShift({ startMinute: 1200, endMinute: 1260 }, plan)).toEqual({ startMinute: 1200, endMinute: 1260 });
    const day = { effective: { isWorkDay: true, segments: [{ startMinute: 480, endMinute: 720 }] } };
    expect(alignToShift({ startMinute: 300, endMinute: 500 }, day)).toEqual({ startMinute: 300, endMinute: 500 });
  });

  it("data de hoje respeita o fuso da aplicação", () => {
    // 02:00 UTC de 23/10 ainda é 22/10 em São Paulo (UTC-3)
    expect(todayInTimeZone("America/Sao_Paulo", new Date("2026-10-23T02:00:00Z"))).toEqual(parseDateKey("2026-10-22"));
  });

  it("rejeita datas impossíveis", () => {
    expect(() => parseDateKey("2026-02-30")).toThrow();
  });
});

describe("auditoria", () => {
  it("remove campos sensíveis e calcula diferenças", () => {
    const r = redact({ name: "A", passwordHash: "x", restrictedNotes: "segredo", searchText: "y" });
    expect(r).toEqual({ name: "A", restrictedNotes: "[restrito]" });
    const d = diff({ a: 1, b: "x", restrictedNotes: "s1" }, { a: 2, b: "x", restrictedNotes: "s2" });
    expect(d).toEqual({ a: { from: 1, to: 2 } });
    expect(JSON.stringify(d)).not.toContain("s1");
  });
});
