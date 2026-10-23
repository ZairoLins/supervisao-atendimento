/** Normaliza texto para pesquisa: minúsculas, sem acentos, espaços colapsados. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza um termo de pesquisa digitado pelo usuário. Remove curingas de LIKE
 * (% _ \) para que sejam tratados como texto comum; a consulta é sempre parametrizada.
 */
export function normalizeQuery(value: string | null | undefined): string {
  return normalizeText(value).replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Monta o texto indexável a partir de campos não sensíveis. */
export function buildSearchText(...parts: Array<string | number | null | undefined>): string {
  return normalizeText(parts.filter((p) => p !== null && p !== undefined && p !== "").join(" ")).slice(0, 4000);
}

export const CODE_PREFIX = {
  employee: "COL",
  meeting: "REU",
  occurrence: "OCO",
  feedback: "FDB",
} as const;

export type CodeEntity = keyof typeof CODE_PREFIX;

export function formatCode(entity: CodeEntity, code: number): string {
  return `${CODE_PREFIX[entity]}-${String(code).padStart(4, "0")}`;
}

/** Reconhece identificadores como "REU-12", "reu 0012" ou "#12". */
export function parseCodeQuery(query: string): { entity: CodeEntity | null; code: number } | null {
  const q = query.trim().toUpperCase();
  const prefixed = /^([A-Z]{3})[\s-]?0*(\d{1,9})$/.exec(q);
  if (prefixed) {
    const entry = (Object.entries(CODE_PREFIX) as Array<[CodeEntity, string]>).find(([, p]) => p === prefixed[1]);
    if (entry) return { entity: entry[0], code: Number(prefixed[2]) };
    return null;
  }
  const bare = /^#?0*(\d{1,9})$/.exec(q);
  if (bare) return { entity: null, code: Number(bare[1]) };
  return null;
}

export function truncate(value: string | null | undefined, max = 140): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Divide um texto em partes destacadas para o termo pesquisado, ignorando acentos e
 * maiúsculas. Retorna segmentos para renderização segura (sem HTML).
 */
export function highlightSegments(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = normalizeText(query);
  if (!q || !text) return [{ text, match: false }];
  // Normalização caractere a caractere preservando o mapeamento de posições
  const map: number[] = [];
  let norm = "";
  for (let i = 0; i < text.length; i++) {
    const n = text[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (let k = 0; k < n.length; k++) {
      norm += n[k];
      map.push(i);
    }
  }
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let from = 0;
  while (from <= norm.length - q.length) {
    const idx = norm.indexOf(q, from);
    if (idx === -1) break;
    const start = map[idx];
    const end = map[idx + q.length - 1] + 1;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
    from = idx + q.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length ? segments : [{ text, match: false }];
}
