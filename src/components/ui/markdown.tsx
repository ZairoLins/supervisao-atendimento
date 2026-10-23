import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./primitives";

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Procura a caixa de seleção gerada pelo GFM no item de lista (direta ou dentro do parágrafo). */
function taskChecked(node: HastNode | undefined): boolean | null {
  for (const child of node?.children ?? []) {
    if (child.type === "element" && child.tagName === "input" && child.properties?.type === "checkbox") return Boolean(child.properties.checked);
    if (child.type === "element" && child.tagName === "p") return taskChecked(child);
  }
  return null;
}

/**
 * Renderiza Markdown (GFM) sem HTML bruto: tags digitadas não são interpretadas.
 * `renderTask` troca a caixa de seleção das listas de tarefas por um controle
 * (ex.: marcar item como discutido); recebe a linha do item no texto original.
 */
export function Markdown({
  children,
  className,
  renderTask,
}: {
  children: string;
  className?: string;
  renderTask?: (line: number, checked: boolean) => ReactNode;
}) {
  const components: Components = {
    a: ({ href, children: label }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ),
    img: ({ alt }) => <span className="text-subtle">[imagem: {alt || "sem descrição"}]</span>,
    input: ({ checked, type }) => {
      if (type !== "checkbox" || renderTask) return null;
      return <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="md-check" aria-label={checked ? "Discutido" : "Não discutido"} />;
    },
    li: ({ node, children: content, className: liClass }) => {
      const checked = taskChecked(node as HastNode | undefined);
      const line = node?.position?.start.line ?? 0;
      if (checked === null || !renderTask || !line) return <li className={liClass}>{content}</li>;
      return (
        <li className={cx(liClass, "md-task", checked && "md-task-done")}>
          {renderTask(line, checked)}
          <div className="min-w-0 flex-1">{content}</div>
        </li>
      );
    },
  };
  return (
    <div className={cx("md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
