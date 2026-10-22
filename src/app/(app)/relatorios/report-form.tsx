"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Download, LoaderCircle } from "lucide-react";
import { REPORT_LABELS, type ReportKind } from "@/modules/reports/types";

type Opt = { value: string; label: string };

const STATUS_OPTIONS: Partial<Record<ReportKind, Opt[]>> = {
  frequencia: [
    { value: "PENDING", label: "A conferir" },
    { value: "CONFIRMED", label: "Conferido" },
    { value: "DISREGARDED", label: "Desconsiderado" },
  ],
  reunioes: [
    { value: "SCHEDULED", label: "Agendada" },
    { value: "DONE", label: "Realizada" },
    { value: "CANCELED", label: "Cancelada" },
  ],
  tarefas: [
    { value: "PENDING", label: "Pendente" },
    { value: "IN_PROGRESS", label: "Em andamento" },
    { value: "DONE", label: "Concluída" },
    { value: "CANCELED", label: "Cancelada" },
  ],
  feedbacks: [
    { value: "OPEN", label: "Aberto" },
    { value: "FOLLOW_UP", label: "Em acompanhamento" },
    { value: "CLOSED", label: "Concluído" },
  ],
};

/**
 * Formulário de exportação: gera o arquivo no servidor e baixa no navegador,
 * exibindo mensagens de validação sem sair da página.
 */
export function ReportForm({
  kinds,
  employees,
  categories,
}: {
  kinds: ReportKind[];
  employees: Opt[];
  categories: Partial<Record<ReportKind, Opt[]>>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ReportKind>(kinds[0]);
  const [state, setState] = useState<{ status: "idle" | "loading" | "ok" | "error"; message?: string }>({ status: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "") params.set(k, v);
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/relatorios?${params.toString()}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ status: "error", message: body?.error ?? "Não foi possível gerar o relatório." });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "relatorio";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState({ status: "ok", message: `Arquivo ${name} gerado.` });
    } catch {
      setState({ status: "error", message: "Falha de conexão ao gerar o relatório." });
    }
  }

  const statusOptions = STATUS_OPTIONS[kind];
  const categoryOptions = categories[kind];
  const needsEmployee = kind === "desempenho";

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 md:grid-cols-2" noValidate>
      <fieldset className="md:col-span-2">
        <legend className="label">Relatório</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {kinds.map((k) => (
            <label key={k} className={`cursor-pointer rounded-[12px] border p-4 transition-colors ${kind === k ? "border-cream bg-surface-2" : "border-cork hover:border-driftwood"}`}>
              <input type="radio" name="tipo" value={k} checked={kind === k} onChange={() => { setKind(k); setState({ status: "idle" }); }} className="sr-only" />
              <span className="subheading block">{REPORT_LABELS[k].title}</span>
              <span className="mt-2 block text-xs text-subtle">{REPORT_LABELS[k].description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="r-de">{kind === "tarefas" ? "Prazo a partir de" : "Período — de"}</label>
        <input id="r-de" type="date" name="de" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="r-ate">{kind === "tarefas" ? "Prazo até" : "Período — até"}</label>
        <input id="r-ate" type="date" name="ate" className="input" />
        <p className="mt-1.5 text-xs text-subtle">Em branco: período padrão do relatório.</p>
      </div>
      <div>
        <label className="label" htmlFor="r-col">Colaborador{needsEmployee ? <span className="accent"> *</span> : null}</label>
        <select id="r-col" name="colaborador" className="input" key={kind}>
          <option value="">{needsEmployee ? "Selecione…" : "Todos"}</option>
          {employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
      </div>
      {statusOptions ? (
        <div>
          <label className="label" htmlFor="r-st">Status</label>
          <select id="r-st" name="status" className="input" key={`s-${kind}`}>
            <option value="">{kind === "tarefas" ? "Em aberto (padrão)" : "Todos"}</option>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ) : <div className="hidden md:block" />}
      {categoryOptions ? (
        <div>
          <label className="label" htmlFor="r-cat">{kind === "metricas" ? "Equipe" : kind === "tarefas" ? "Prioridade" : kind === "frequencia" ? "Tipo de ocorrência" : "Tipo"}</label>
          <select id="r-cat" name="categoria" className="input" key={`c-${kind}`}>
            <option value="">Todos</option>
            {categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ) : null}

      {kind === "frequencia" ? (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm md:col-span-2">
          <input type="checkbox" name="observacoes" value="1" className="checkbox mt-0.5" />
          <span>Incluir observações administrativas <span className="block text-xs text-subtle">Nunca inclui dados médicos, informações restritas ou anexos.</span></span>
        </label>
      ) : null}
      {kind === "feedbacks" ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-dashed border-warn/40 p-4 md:col-span-2">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" name="confirmar" value="1" className="checkbox mt-0.5" />
            <span>Confirmo a exportação de feedbacks individuais para uso restrito da supervisão.</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" name="detalhes" value="1" className="checkbox mt-0.5" />
            <span>Incluir conteúdo detalhado (contexto, pontos e ações acordadas)</span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={state.status === "loading"} onClick={(e) => setFormat(e.currentTarget, "xlsx")}>
          {state.status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />} Excel (.xlsx)
        </button>
        <button type="submit" className="btn btn-secondary" disabled={state.status === "loading"} onClick={(e) => setFormat(e.currentTarget, "pdf")}>
          <Download className="size-3.5" aria-hidden /> PDF
        </button>
        <input type="hidden" name="formato" defaultValue="xlsx" data-format />
        {state.status === "error" ? <p role="alert" className="flex items-center gap-2 text-sm text-danger"><CircleAlert className="size-4" aria-hidden /> {state.message}</p> : null}
        {state.status === "ok" ? <p role="status" className="flex items-center gap-2 text-sm text-ok"><CircleCheck className="size-4" aria-hidden /> {state.message}</p> : null}
      </div>
    </form>
  );
}

/** O botão clicado define o formato (FormData do onSubmit não inclui o submitter em todos os navegadores). */
function setFormat(button: HTMLButtonElement, format: "xlsx" | "pdf") {
  const hidden = button.form?.querySelector<HTMLInputElement>("input[data-format]");
  if (hidden) hidden.value = format;
}
