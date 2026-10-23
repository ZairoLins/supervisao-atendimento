/**
 * Utilitários de Markdown da pauta (funções puras, usadas no servidor e no navegador).
 * Itens de lista de tarefas ("- [ ]" / "- [x]") marcam o que já foi discutido.
 */

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/** Alterna (ou define) a marcação do item de tarefa na linha informada (1 = primeira linha). */
export function toggleTaskAtLine(md: string, line: number, checked?: boolean): string | null {
  const lines = md.split(/\r?\n/);
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const m = TASK.exec(lines[idx]);
  if (!m) return null;
  const next = checked ?? m[2] === " ";
  lines[idx] = lines[idx].replace(TASK, `$1[${next ? "x" : " "}]$3`);
  return lines.join("\n");
}

/** Quantidade de itens de lista na pauta e quantos estão marcados como discutidos. */
export function agendaStats(md: string | null | undefined): { items: number; done: number } {
  let items = 0;
  let done = 0;
  for (const l of (md ?? "").split(/\r?\n/)) {
    if (!LIST_ITEM.test(l) || /^\s{2,}/.test(l)) continue;
    items++;
    const t = TASK.exec(l);
    if (t && t[2] !== " ") done++;
  }
  return { items, done };
}

function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1");
}

/** Texto simples (para pesquisa e resumos). */
export function markdownToPlain(md: string | null | undefined): string {
  return (md ?? "")
    .split(/\r?\n/)
    .map((l) =>
      stripInline(
        l
          .replace(/^\s*#{1,6}\s+/, "")
          .replace(/^\s*>\s?/, "")
          .replace(TASK, "")
          .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
          .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, "")
          .replace(/^\s*```.*$/, ""),
      ).trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Converte Markdown para a formatação do WhatsApp:
 * **negrito** → *negrito*, *itálico* → _itálico_, ~~riscado~~ → ~riscado~,
 * títulos em negrito, listas com marcadores e links como "texto (url)".
 */
export function markdownToWhatsApp(md: string | null | undefined): string {
  let inCode = false;
  const out: string[] = [];
  for (const raw of (md ?? "").split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      out.push("```");
      continue;
    }
    if (inCode) {
      out.push(raw);
      continue;
    }
    let l = raw;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(l);
    if (heading) {
      out.push(`*${inline(heading[1]).replace(/\*/g, "")}*`);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out.push("──────────");
      continue;
    }
    const indent = (/^(\s*)/.exec(l)?.[1].length ?? 0) >= 2 ? "   " : "";
    const task = TASK.exec(l);
    if (task) l = `${indent}${task[2] === " " ? "☐" : "☑"} ${l.slice(task[0].length - task[3].length).trimStart()}`;
    else if (/^\s*[-*+]\s+/.test(l)) l = `${indent}• ${l.replace(/^\s*[-*+]\s+/, "")}`;
    else if (/^\s*\d+[.)]\s+/.test(l)) l = `${indent}${l.trimStart()}`;
    else if (/^\s*>\s?/.test(l)) l = `> ${l.replace(/^\s*>\s?/, "")}`;
    out.push(inline(l));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  function inline(s: string): string {
    // Marcadores temporários evitam que o negrito convertido seja lido como itálico.
    return s
      .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t: string, u: string) => (t === u ? u : `${t} (${u})`))
      .replace(/(\*\*|__)(.+?)\1/g, "\u0001$2\u0001")
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1_$2_")
      .replace(/~~(.+?)~~/g, "~$1~")
      .replace(/\u0001/g, "*");
  }
}
