"use client";

import { useRef, useState, type ReactNode } from "react";
import { Bold, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote } from "lucide-react";
import { FieldShell, useField } from "./form";
import { Markdown } from "./markdown";
import { cx } from "./primitives";

type Tool = { label: string; icon: typeof Bold; apply: (sel: string) => { text: string; cursor?: number } ; line?: boolean };

const TOOLS: Tool[] = [
  { label: "Negrito", icon: Bold, apply: (s) => ({ text: `**${s || "texto"}**` }) },
  { label: "Itálico", icon: Italic, apply: (s) => ({ text: `*${s || "texto"}*` }) },
  { label: "Título", icon: Heading2, apply: (s) => ({ text: `## ${s || "Título"}` }), line: true },
  { label: "Lista", icon: List, apply: (s) => ({ text: prefixLines(s || "Item", "- ") }), line: true },
  { label: "Lista numerada", icon: ListOrdered, apply: (s) => ({ text: prefixLines(s || "Item", (i) => `${i + 1}. `) }), line: true },
  { label: "Item de pauta (checklist)", icon: ListChecks, apply: (s) => ({ text: prefixLines(s || "Assunto", "- [ ] ") }), line: true },
  { label: "Citação", icon: Quote, apply: (s) => ({ text: prefixLines(s || "Destaque", "> ") }), line: true },
  { label: "Link", icon: Link2, apply: (s) => ({ text: `[${s || "texto"}](https://)` }) },
];

function prefixLines(s: string, prefix: string | ((i: number) => string)) {
  return s
    .split("\n")
    .map((l, i) => `${typeof prefix === "string" ? prefix : prefix(i)}${l}`)
    .join("\n");
}

/** Campo de texto em Markdown com barra de formatação e pré-visualização. */
export function MarkdownField({
  name,
  label,
  hint,
  defaultValue,
  rows = 10,
  maxLength,
  placeholder,
  className,
  emptyPreview = "Nada para visualizar ainda.",
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  defaultValue?: string | null;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  emptyPreview?: string;
}) {
  const f = useField(name, defaultValue);
  const [value, setValue] = useState(f.value);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(tool: Tool) {
    const el = ref.current;
    if (!el) return;
    let start = el.selectionStart;
    const end = el.selectionEnd;
    // Ferramentas de linha começam no início da linha atual
    if (tool.line) while (start > 0 && value[start - 1] !== "\n") start--;
    const { text } = tool.apply(value.slice(start, end));
    const before = value.slice(0, start);
    const needsBreak = tool.line && before.length > 0 && !before.endsWith("\n");
    const next = `${before}${needsBreak ? "\n" : ""}${text}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + (needsBreak ? 1 : 0) + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} className={className}>
      <div className={cx("md-editor", f.error && "md-editor-error")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-2 py-1.5">
          <div role="tablist" aria-label="Modo do editor" className="flex gap-1">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx("rounded-md px-3 py-1 text-xs font-medium", tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
              >
                {t === "write" ? "Escrever" : "Visualizar"}
              </button>
            ))}
          </div>
          {tab === "write" ? (
            <div className="flex flex-wrap gap-0.5" aria-label="Formatação">
              {TOOLS.map((tool) => (
                <button key={tool.label} type="button" onClick={() => apply(tool)} className="btn btn-ghost btn-sm px-2" title={tool.label} aria-label={tool.label}>
                  <tool.icon className="size-3.5" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <textarea
          ref={ref}
          id={f.id}
          name={name}
          rows={rows}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          hidden={tab !== "write"}
          aria-invalid={f.error ? true : undefined}
          className="block w-full resize-y bg-surface px-3 py-2.5 font-mono text-sm leading-relaxed outline-none"
        />
        {tab === "preview" ? (
          <div className="min-h-32 bg-surface px-4 py-3">
            {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-subtle">{emptyPreview}</p>}
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
}
