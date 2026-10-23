"use client";

import { useRef, useState, type ReactNode } from "react";
import { CircleAlert, RotateCcw, Undo2 } from "lucide-react";
import { renderTemplate, sampleVars, TEMPLATES, validateTemplate, type TemplateKey } from "@/modules/whatsapp/templates";
import { resetTemplateAction, saveTemplateAction } from "@/modules/whatsapp/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton, useFormState } from "@/components/ui/form";
import { cx } from "@/components/ui/primitives";

/** Formatação do WhatsApp na pré-visualização: *negrito*, _itálico_, ~riscado~ e ```monoespaçado```. */
function waInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = out.length;
    if (m[1] !== undefined) out.push(<code key={k} className="font-mono text-[0.92em]">{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{waInline(m[2])}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{waInline(m[3])}</em>);
    else out.push(<s key={k}>{waInline(m[4])}</s>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function WhatsAppBubble({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-[#efeae2] p-4">
      <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap text-[#111b21] shadow-sm">
        {text ? waInline(text) : <span className="text-[#667781]">(mensagem vazia)</span>}
        <span className="mt-1 block text-right text-[10px] text-[#667781]">09:00 ✓✓</span>
      </div>
    </div>
  );
}

function Editor({ templateKey, body }: { templateKey: TemplateKey; body: string }) {
  const def = TEMPLATES[templateKey];
  const state = useFormState();
  const initial = !state.ok && state.values?.body !== undefined ? state.values.body : body;
  const [value, setValue] = useState(initial);
  const [emptyVars, setEmptyVars] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLTextAreaElement>(null);
  const problems = validateTemplate(templateKey, value);
  const vars = Object.fromEntries(Object.entries(sampleVars(templateKey)).map(([k, v]) => [k, emptyVars.has(k) ? "" : v]));
  const preview = problems.length ? "" : renderTemplate(value, vars);

  function insert(snippet: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Hidden name="key" value={templateKey} />
        <div>
          <label htmlFor="tpl-body" className="label">Texto da mensagem</label>
          <textarea
            ref={ref}
            id="tpl-body"
            name="body"
            rows={18}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={4000}
            spellCheck
            aria-invalid={problems.length || state.fieldErrors?.body ? true : undefined}
            className="input font-mono text-[13px] leading-relaxed"
          />
          {problems.length ? (
            <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {problems.join(" ")}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-subtle">*negrito*, _itálico_, ~riscado~. Emojis podem ser colados direto no texto.</p>
          )}
        </div>
        <div>
          <p className="label">Variáveis disponíveis <span className="font-normal text-subtle">(clique para inserir)</span></p>
          <ul className="flex flex-col gap-1.5">
            {def.variables.map((v) => (
              <li key={v.name} className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={() => insert(`{{${v.name}}}`)} className="rounded-md bg-primary-soft px-2 py-1 font-mono text-primary-ink hover:bg-primary/15">
                  {`{{${v.name}}}`}
                </button>
                <span className="text-muted">{v.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-subtle">
            Trecho opcional: <code className="font-mono">{"{{#local}}📍 {{local}}{{/local}}"}</code> só aparece se houver local; <code className="font-mono">{"{{^pauta}}...{{/pauta}}"}</code> aparece quando a variável está vazia.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton>Salvar modelo</SubmitButton>
          <button type="button" className="btn btn-ghost" onClick={() => setValue(body)} disabled={value === body}>
            <Undo2 className="size-3.5" aria-hidden /> Desfazer alterações
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setValue(def.defaultBody)} disabled={value === def.defaultBody}>
            <RotateCcw className="size-3.5" aria-hidden /> Usar texto padrão
          </button>
        </div>
        <FormMessage />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label mb-0">Pré-visualização</p>
          <span className="text-xs text-subtle">com dados de exemplo</span>
        </div>
        <WhatsAppBubble text={preview} />
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-medium text-muted">Simular variáveis vazias</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {def.variables.map((v) => (
              <label key={v.name} className={cx("flex cursor-pointer items-center gap-1.5 text-xs", emptyVars.has(v.name) ? "text-ink" : "text-muted")}>
                <input
                  type="checkbox"
                  className="checkbox size-3.5"
                  checked={emptyVars.has(v.name)}
                  onChange={(e) => {
                    const next = new Set(emptyVars);
                    if (e.target.checked) next.add(v.name);
                    else next.delete(v.name);
                    setEmptyVars(next);
                  }}
                />
                {v.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

export function TemplateEditor({ templateKey, body, customized }: { templateKey: TemplateKey; body: string; customized: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ActionForm key={`${templateKey}:${body}`} action={saveTemplateAction}>
        <Editor templateKey={templateKey} body={body} />
      </ActionForm>
      {customized ? (
        <ActionForm action={resetTemplateAction.bind(null, templateKey)} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <SubmitButton variant="ghost" className="btn-sm" confirm="Descartar o texto personalizado e voltar ao padrão do sistema?">
            <RotateCcw className="size-3.5" aria-hidden /> Restaurar padrão do sistema
          </SubmitButton>
          <FormMessage />
        </ActionForm>
      ) : null}
    </div>
  );
}
