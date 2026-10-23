import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalSearch } from "@/modules/search/service";
import { createMeeting } from "@/modules/meetings/service";
import { createOccurrence } from "@/modules/attendance/occurrences";
import { createFeedback, createNote } from "@/modules/feedbacks/service";
import { createMetric } from "@/modules/metrics/service";
import type { Actor } from "@/lib/permissions";
import { createUser, disconnect, hasTestDb, resetDb, testDb } from "../support/db";
import { makeEmployee, occurrenceType } from "../support/factories";

const titles = (r: Awaited<ReturnType<typeof globalSearch>>) => r.groups.flatMap((g) => g.items.map((i) => `${g.type}:${i.title}`));

describe.skipIf(!hasTestDb)("pesquisa global", () => {
  let sup: Actor;
  let asst: Actor;

  beforeAll(async () => {
    await resetDb();
    sup = await createUser();
    asst = await createUser("ASSISTANT");

    // Módulos sem registros: a pesquisa deve funcionar normalmente
    const empty = await globalSearch(testDb(), sup, "qualquer", { limit: 5 });
    expect(empty.total).toBe(0);

    const ana = await makeEmployee(sup, { fullName: "Ana Beatriz Conceição", jobTitle: "Atendente Pleno", team: "Suporte Noturno" });
    await makeEmployee(sup, { fullName: "Bruno Anastácio", team: "Central" });
    await createMeeting(testDb(), sup, {
      title: "Planejamento de férias coletivas",
      type: "EXTRAORDINARY",
      date: "2026-11-05",
      startTime: "10:00",
      agenda: "Revisão da escala de dezembro\nIndicadores de satisfação",
      participantIds: [ana.id],
    });
    await createMetric(testDb(), sup, { employeeId: ana.id, week: "2026-09-18", ticketsHandled: "210", avgHandleMinutes: "7", avgRating: "9", ratingCount: "210" }, new Date(Date.UTC(2026, 9, 23)));
    const atestado = await occurrenceType("ATESTADO");
    await createOccurrence(testDb(), sup, { employeeId: ana.id, typeId: atestado.id, date: "2026-10-02", adminNotes: "Entregue na recepção", restrictedNotes: "Diagnóstico sigiloso XPTO" });
    await createFeedback(testDb(), sup, { employeeId: ana.id, date: "2026-10-03", type: "RECOGNITION", context: "Elogio de cliente sobre empatia", positives: "Detalhe privado da conversa" });
    await createNote(testDb(), sup, { employeeId: ana.id, date: "2026-10-04", category: "OBSERVATION", title: "Treinamento em ferramenta nova", content: "Concluiu o módulo 1" });
  });
  afterAll(disconnect);

  it("encontra colaborador pelo nome completo, com correspondência exata primeiro", async () => {
    const r = await globalSearch(testDb(), sup, "Ana Beatriz Conceição", { limit: 5 });
    expect(r.groups[0].type).toBe("employee");
    expect(r.groups[0].items[0].title).toBe("Ana Beatriz Conceição");
    expect(r.groups[0].items[0].url).toMatch(/^\/colaboradores\/[0-9a-f-]{36}$/);
  });

  it("encontra por parte do nome, ignorando acentos e maiúsculas, priorizando início", async () => {
    const r = await globalSearch(testDb(), sup, "ana", { limit: 5, types: ["employee"] });
    const names = r.groups[0].items.map((i) => i.title);
    expect(names).toEqual(["Ana Beatriz Conceição", "Bruno Anastácio"]);
    const r2 = await globalSearch(testDb(), sup, "conceicao", { limit: 5 });
    expect(titles(r2)).toContain("employee:Ana Beatriz Conceição");
  });

  it("encontra funções e equipes", async () => {
    const r = await globalSearch(testDb(), sup, "suporte noturno", { limit: 5 });
    expect(titles(r)).toContain("team:Suporte Noturno");
  });

  it("encontra reunião pelo título e por palavra da pauta", async () => {
    const r = await globalSearch(testDb(), sup, "férias coletivas", { limit: 5 });
    expect(titles(r)).toContain("meeting:Planejamento de férias coletivas");
    const r2 = await globalSearch(testDb(), sup, "dezembro", { limit: 5 });
    expect(titles(r2)).toContain("meeting:Planejamento de férias coletivas");
  });

  it("encontra por identificador", async () => {
    const r = await globalSearch(testDb(), sup, "COL-1", { limit: 5 });
    expect(r.groups[0].items[0].title).toBe("Ana Beatriz Conceição");
    expect(r.groups[0].items[0].score).toBeGreaterThanOrEqual(1000);
    const meeting = await testDb().meeting.findFirstOrThrow();
    const r2 = await globalSearch(testDb(), sup, `reu-${meeting.code}`, { limit: 5 });
    expect(r2.groups[0].type).toBe("meeting");
  });

  it("encontra métricas por mês e por data da semana", async () => {
    const r = await globalSearch(testDb(), sup, "09/2026", { limit: 5 });
    expect(r.groups.some((g) => g.type === "metric")).toBe(true);
    // Qualquer dia da semana encontra o lançamento semanal
    const r2 = await globalSearch(testDb(), sup, "16/09/2026", { limit: 5, types: ["metric"] });
    expect(r2.groups[0].items[0].title).toBe("Ana Beatriz Conceição — semana 14/09 a 20/09/2026");
    const r3 = await globalSearch(testDb(), sup, "21/09/2026", { limit: 5, types: ["metric"] });
    expect(r3.total).toBe(0);
  });

  it("retorna vazio para expressão sem resultados", async () => {
    const r = await globalSearch(testDb(), sup, "xyzinexistente987", { limit: 5 });
    expect(r.total).toBe(0);
    expect(r.groups).toEqual([]);
  });

  it("trata caracteres especiais com segurança (sem curingas nem injeção)", async () => {
    for (const q of ["%", "_ _", "'; DROP TABLE \"Employee\"; --", "\\", "a%b", "(()", "ç"]) {
      const r = await globalSearch(testDb(), sup, q, { limit: 5 });
      expect(Array.isArray(r.groups)).toBe(true);
    }
    expect((await globalSearch(testDb(), sup, "%%", { limit: 5 })).total).toBe(0);
    expect(await testDb().employee.count()).toBe(2);
  });

  it("nunca expõe conteúdo restrito nem detalhes de feedback", async () => {
    const r1 = await globalSearch(testDb(), sup, "sigiloso", { limit: 10 });
    expect(r1.total).toBe(0);
    const r2 = await globalSearch(testDb(), sup, "recepcao", { limit: 10 }); // observação de atestado (tipo médico) não é indexada
    expect(r2.groups.find((g) => g.type === "occurrence")).toBeUndefined();
    const r3 = await globalSearch(testDb(), sup, "Detalhe privado", { limit: 10 });
    expect(r3.total).toBe(0);
    const all = JSON.stringify(await globalSearch(testDb(), sup, "ana", { limit: 20 }));
    expect(all).not.toContain("XPTO");
    expect(all).not.toContain("Detalhe privado");
  });

  it("respeita permissões: perfil auxiliar não vê frequência, feedbacks nem anotações", async () => {
    const r = await globalSearch(testDb(), asst, "ana", { limit: 20 });
    const types = r.groups.map((g) => g.type);
    expect(types).toContain("employee");
    expect(types).not.toContain("occurrence");
    expect(types).not.toContain("feedback");
    expect(types).not.toContain("note");
    // Nem mesmo filtrando explicitamente pela categoria restrita
    const r2 = await globalSearch(testDb(), asst, "ana", { limit: 20, types: ["feedback", "occurrence", "note"] });
    expect(r2.total).toBe(0);
    // Supervisor vê as categorias
    const r3 = await globalSearch(testDb(), sup, "ana", { limit: 20 });
    expect(r3.groups.map((g) => g.type)).toEqual(expect.arrayContaining(["occurrence", "feedback", "note"]));
  });

  it("filtra por período e limita resultados por categoria", async () => {
    const r = await globalSearch(testDb(), sup, "ana", { limit: 1, types: ["employee"] });
    expect(r.groups[0].items).toHaveLength(1);
    expect(r.groups[0].hasMore).toBe(true);
    const inPeriod = await globalSearch(testDb(), sup, "ferias", { limit: 5, types: ["meeting"], from: new Date(Date.UTC(2026, 10, 1)), to: new Date(Date.UTC(2026, 10, 30)) });
    expect(inPeriod.total).toBe(1);
    const outPeriod = await globalSearch(testDb(), sup, "ferias", { limit: 5, types: ["meeting"], from: new Date(Date.UTC(2026, 0, 1)), to: new Date(Date.UTC(2026, 0, 31)) });
    expect(outPeriod.total).toBe(0);
  });

  it("ignora termos curtos demais", async () => {
    expect((await globalSearch(testDb(), sup, "a", { limit: 5 })).total).toBe(0);
  });
});
