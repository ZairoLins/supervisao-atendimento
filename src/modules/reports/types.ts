export type ReportCell = string | number | null;

export type ReportColumn = {
  key: string;
  header: string;
  /** Largura relativa (Excel: caracteres; PDF: proporção) */
  width: number;
  kind?: "text" | "number" | "decimal";
};

export type ReportData = {
  title: string;
  /** Linhas de contexto: período, filtros aplicados */
  meta: string[];
  generatedAt: Date;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  totals?: Record<string, ReportCell>;
  notes?: string[];
};

export const REPORT_KINDS = ["semanal", "metricas", "desempenho", "frequencia", "reunioes", "feedbacks"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, { title: string; description: string }> = {
  semanal: { title: "Relatório semanal", description: "Resumo visual da semana: indicadores, gráfico por colaborador e comparação com a semana anterior." },
  metricas: { title: "Métricas semanais (lista)", description: "Todos os lançamentos semanais do período, com totais." },
  desempenho: { title: "Histórico de desempenho individual", description: "Evolução mês a mês de um colaborador (soma das semanas), com variação percentual." },
  frequencia: { title: "Frequência e ocorrências", description: "Horas previstas, ausências e ocorrências por colaborador. Sem dados médicos." },
  reunioes: { title: "Reuniões e decisões", description: "Reuniões do período com as decisões registradas." },
  feedbacks: { title: "Feedbacks", description: "Exige confirmação explícita. Conteúdo detalhado apenas se selecionado." },
};
