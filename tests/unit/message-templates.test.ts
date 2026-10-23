import { describe, expect, it } from "vitest";
import { renderTemplate, sampleVars, TEMPLATE_KEYS, TEMPLATES, validateTemplate } from "@/modules/whatsapp/templates";

describe("modelos de mensagem", () => {
  const meeting = { titulo: "Semanal", quando: "Segunda-feira, 27/10/2026 · 09:00", local: "Sala 2", pauta: "☐ Recados\n☐ *Indicadores*" };

  it("aviso de reunião: 'Pauta:' em linha própria e trechos opcionais", () => {
    expect(renderTemplate(TEMPLATES.MEETING_REMINDER.defaultBody, meeting)).toBe(
      "📣 *Lembrete de reunião*\n\n*Semanal*\n🗓 Segunda-feira, 27/10/2026 · 09:00\n📍 Sala 2\n\n*Pauta:*\n\n☐ Recados\n☐ *Indicadores*\n\nConto com a presença de todos!",
    );
    expect(renderTemplate(TEMPLATES.MEETING_REMINDER.defaultBody, { ...meeting, local: "", pauta: null })).toBe(
      "📣 *Lembrete de reunião*\n\n*Semanal*\n🗓 Segunda-feira, 27/10/2026 · 09:00\n\nConto com a presença de todos!",
    );
  });

  it("cancelamento com e sem motivo", () => {
    expect(renderTemplate(TEMPLATES.MEETING_CANCELED.defaultBody, { ...meeting, motivo: "Treinamento" })).toBe(
      "⚠️ *Reunião cancelada*\n\n*Semanal*\n🗓 Segunda-feira, 27/10/2026 · 09:00\n\n*Motivo:* Treinamento\n\nAssim que houver nova data, aviso por aqui.",
    );
    expect(renderTemplate(TEMPLATES.MEETING_CANCELED.defaultBody, meeting)).not.toContain("Motivo");
  });

  it("blocos invertidos, aninhados e no meio da linha", () => {
    expect(renderTemplate(TEMPLATES.MEETING_AGENDA.defaultBody, { titulo: "X", quando: "Q", codigo: "REU-0001" })).toBe("*Pauta — X*\n🗓 Q\n\n_Pauta ainda não preenchida._\n\n_REU-0001 · Supervisão de Atendimento_");
    expect(renderTemplate(TEMPLATES.OCCURRENCES.defaultBody, { periodo: "P", tem_ocorrencias: "" })).toBe("*Ocorrências — P*\n\nNenhuma ocorrência registrada no período.");
    const occ = renderTemplate(TEMPLATES.OCCURRENCES.defaultBody, { periodo: "P", tem_ocorrencias: "sim", total: "3", colaboradores: "2", equipe: "9", ausencia: "4h", a_conferir: "", por_tipo: "• Falta: 3", por_colaborador: "• Ana: Falta 3" });
    expect(occ).toContain("• Ocorrências: *3*");
    expect(occ).not.toContain("A conferir");
    expect(renderTemplate(TEMPLATES.MONTHLY_METRICS.defaultBody, { mes: "M", nota: "9", avaliacoes: "" })).toContain("• Nota média: *9*\n");
    expect(renderTemplate(TEMPLATES.MONTHLY_METRICS.defaultBody, { mes: "M", nota: "9", avaliacoes: "12" })).toContain("• Nota média: *9* (12 avaliações)\n");
  });

  it("valida variáveis e blocos", () => {
    for (const k of TEMPLATE_KEYS) {
      expect(validateTemplate(k, TEMPLATES[k].defaultBody)).toEqual([]);
      expect(renderTemplate(TEMPLATES[k].defaultBody, sampleVars(k))).not.toMatch(/\{\{|\}\}/);
    }
    expect(validateTemplate("MEETING_REMINDER", "Olá {{nome}}")[0]).toMatch(/desconhecida: \{\{nome\}\}/);
    expect(validateTemplate("MEETING_REMINDER", "{{#local}}x")[0]).toMatch(/sem fechamento/);
    expect(validateTemplate("MEETING_REMINDER", "x{{/local}}")[0]).toMatch(/sem abertura/);
    expect(validateTemplate("MEETING_REMINDER", "{{titulo")[0]).toMatch(/incompletas/);
    expect(validateTemplate("MEETING_REMINDER", "  ")[0]).toMatch(/vazia/);
  });
});
