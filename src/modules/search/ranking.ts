import { normalizeText } from "@/lib/text";

/**
 * Relevância: correspondência exata > início do título > início de palavra > parcial no
 * título > apenas no conteúdo indexado. Identificador exato sempre no topo.
 */
export function scoreMatch(title: string, query: string, opts: { codeMatch?: boolean; recency?: Date | null } = {}): number {
  const t = normalizeText(title);
  const q = normalizeText(query);
  let score = 10;
  if (opts.codeMatch) score = 1000;
  else if (!q) score = 10;
  else if (t === q) score = 500;
  else if (t.startsWith(q)) score = 300;
  else if (new RegExp(`(^|\\s|[-/(])${escapeRegExp(q)}`).test(t)) score = 200;
  else if (t.includes(q)) score = 100;
  else {
    // Todas as palavras do termo presentes no título
    const words = q.split(" ").filter(Boolean);
    if (words.length > 1 && words.every((w) => t.includes(w))) score = 80;
  }
  // Desempate leve por recência (até ~1 ponto)
  if (opts.recency) score += Math.min(1, Math.max(0, opts.recency.getTime() / 1e13));
  return score;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Interpreta termos como "23/10/2026" ou "2026-10-23" como dia. */
export function parseDayQuery(query: string): Date | null {
  const q = query.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(q) ?? null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  const [y, mo, d] = m ? [Number(m[3]), Number(m[2]), Number(m[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
  if (!y) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** Interpreta termos como "10/2026", "out/2026" ou "2026-10" como mês. */
export function parseMonthQuery(query: string): Date | null {
  const q = normalizeText(query);
  let m = /^(\d{1,2})[/-](\d{4})$/.exec(q);
  if (m) return monthDate(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})$/.exec(q);
  if (m) return monthDate(Number(m[1]), Number(m[2]));
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  m = /^([a-z]{3})[a-z]*[/ -]?(?:de )?(\d{4})$/.exec(q);
  if (m) {
    const idx = names.indexOf(m[1]);
    if (idx >= 0) return monthDate(Number(m[2]), idx + 1);
  }
  return null;
}

function monthDate(year: number, month: number): Date | null {
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}
