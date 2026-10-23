/** Formato uniforme de resultados da pesquisa global (compartilhado com o cliente). */
export const SEARCH_TYPES = [
  "employee",
  "team",
  "meeting",
  "metric",
  "feedback",
  "note",
  "occurrence",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  employee: "Colaboradores",
  team: "Funções e equipes",
  meeting: "Reuniões",
  metric: "Métricas semanais",
  feedback: "Feedbacks",
  note: "Anotações",
  occurrence: "Frequência",
};

export type SearchResult = {
  type: SearchType;
  id: string;
  title: string;
  /** Resumo seguro: nunca contém dados restritos */
  summary: string;
  /** Data relevante no formato DD/MM/AAAA, quando houver */
  date: string | null;
  url: string;
  score: number;
};

export type SearchGroup = {
  type: SearchType;
  label: string;
  items: SearchResult[];
  hasMore: boolean;
};

export type SearchResponse = {
  query: string;
  groups: SearchGroup[];
  total: number;
};
