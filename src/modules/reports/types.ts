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

export const REPORT_KINDS = ["metricas", "desempenho", "frequencia", "reunioes", "tarefas", "feedbacks"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, { title: string; description: string }> = {
  metricas: { title: "Métricas mensais", description: "Chamados, tempo médio e avaliação por colaborador e mês." },
  desempenho: { title: "Histórico de desempenho individual", description: "Evolução mensal de um colaborador com variação percentual." },
  frequencia: { title: "Frequência e ocorrências", description: "Horas previstas, ausências e ocorrências por colaborador. Sem dados médicos." },
  reunioes: { title: "Reuniões e ações definidas", description: "Reuniões do período com decisões e tarefas vinculadas." },
  tarefas: { title: "Tarefas pendentes", description: "Tarefas em aberto com prazo, prioridade e responsável." },
  feedbacks: { title: "Feedbacks", description: "Exige confirmação explícita. Conteúdo detalhado apenas se selecionado." },
};
