"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, GripVertical, Pencil, Plus, X } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { createCardAction, deleteCardAction, moveCardAction, updateCardAction } from "@/modules/kanban/actions";
import { ActionForm, FormMessage, Hidden, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { cx } from "@/components/ui/primitives";

export type BoardCard = {
  id: string;
  title: string;
  description: string | null;
  column: Column;
  priority: "LOW" | "NORMAL" | "HIGH";
  dueDate: string | null;
};
type Column = "TODO" | "DOING" | "DONE";

const COLUMNS: Array<{ key: Column; label: string; dot: string; empty: string }> = [
  { key: "TODO", label: "A fazer", dot: "bg-subtle", empty: "Nada pendente." },
  { key: "DOING", label: "Fazendo", dot: "bg-primary", empty: "Arraste uma tarefa para cá ao começar." },
  { key: "DONE", label: "Feito", dot: "bg-ok", empty: "Concluídas aparecem aqui." },
];

const PRIORITY = {
  HIGH: { label: "Alta", cls: "bg-danger-soft text-danger" },
  NORMAL: { label: "Normal", cls: "" },
  LOW: { label: "Baixa", cls: "bg-surface-2 text-subtle" },
} as const;

const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "Alta" },
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Baixa" },
];

function fmtDue(key: string) {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

export function KanbanBoard({ cards: initial, weekKey, todayKey }: { cards: BoardCard[]; weekKey: string; todayKey: string }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ column: Column; index: number } | null>(null);
  const [editing, setEditing] = useState<BoardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Sincroniza com o servidor após cada revalidação
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setCards(initial);
  }

  const byColumn = (c: Column) => cards.filter((x) => x.column === c);

  function move(id: string, column: Column, index: number) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    // Atualização otimista
    const rest = cards.filter((c) => c.id !== id);
    const target = rest.filter((c) => c.column === column);
    const others = rest.filter((c) => c.column !== column);
    target.splice(Math.min(index, target.length), 0, { ...card, column });
    setCards([...others, ...target]);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("column", column);
    fd.set("index", String(index));
    startTransition(async () => {
      const r: ActionState = await moveCardAction({ ok: false }, fd);
      if (!r.ok && r.message) {
        setError(r.message);
        router.refresh();
      }
    });
  }

  function indexAt(e: DragEvent<HTMLElement>, column: Column) {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].filter((el) => el.dataset.card !== dragId);
    const y = e.clientY;
    const idx = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return idx === -1 ? byColumn(column).filter((c) => c.id !== dragId).length : idx;
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 flex items-center gap-2 text-sm text-danger">
          <CircleAlert className="size-4" aria-hidden /> {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {COLUMNS.map((col, ci) => {
          const list = byColumn(col.key);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              className={cx("flex min-h-64 flex-col rounded-2xl border bg-surface-2/70 p-3 transition-colors", over?.column === col.key && dragId ? "border-primary bg-primary-soft/50" : "border-line")}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const index = indexAt(e, col.key);
                if (over?.column !== col.key || over.index !== index) setOver({ column: col.key, index });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, col.key, indexAt(e, col.key));
                setDragId(null);
                setOver(null);
              }}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cx("size-2 rounded-full", col.dot)} aria-hidden />
                  {col.label}
                </h2>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted tabular-nums">{list.length}</span>
              </header>
              <ol className="flex flex-1 flex-col gap-2">
                {list.length === 0 ? <li className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-xs text-subtle">{col.empty}</li> : null}
                {list.map((card, i) => {
                  const overdue = card.dueDate && card.column !== "DONE" && card.dueDate < todayKey;
                  return (
                    <li
                      key={card.id}
                      data-card={card.id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(card.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", card.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                      className={cx(
                        "group relative cursor-grab rounded-xl border border-line bg-surface p-3 shadow-sm transition active:cursor-grabbing",
                        dragId === card.id && "opacity-40",
                        over?.column === col.key && over.index === i && dragId && dragId !== card.id && "mt-3 before:absolute before:-top-2 before:left-2 before:right-2 before:h-0.5 before:rounded before:bg-primary",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 size-4 shrink-0 text-line-strong" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className={cx("text-sm font-medium break-words", card.column === "DONE" && "text-muted line-through decoration-line-strong")}>{card.title}</p>
                          {card.description ? <p className="mt-1 line-clamp-2 text-xs text-subtle whitespace-pre-line">{card.description}</p> : null}
                          {card.priority !== "NORMAL" || card.dueDate ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {card.priority !== "NORMAL" ? <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", PRIORITY[card.priority].cls)}>{PRIORITY[card.priority].label}</span> : null}
                              {card.dueDate ? (
                                <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", overdue ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>
                                  <CalendarDays className="size-3" aria-hidden /> {fmtDue(card.dueDate)}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex justify-end gap-0.5 transition lg:absolute lg:right-1.5 lg:top-1.5 lg:mt-0 lg:rounded-lg lg:border lg:border-line lg:bg-surface lg:opacity-0 lg:shadow-sm lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                        {ci > 0 ? (
                          <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => move(card.id, COLUMNS[ci - 1].key, byColumn(COLUMNS[ci - 1].key).length)} aria-label={`Mover para ${COLUMNS[ci - 1].label}`} title={`Mover para ${COLUMNS[ci - 1].label}`}>
                            <ChevronLeft className="size-3.5" aria-hidden />
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => setEditing(card)} aria-label="Editar tarefa" title="Editar">
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        {ci < COLUMNS.length - 1 ? (
                          <button type="button" className="btn btn-ghost btn-sm px-1.5" onClick={() => move(card.id, COLUMNS[ci + 1].key, byColumn(COLUMNS[ci + 1].key).length)} aria-label={`Mover para ${COLUMNS[ci + 1].label}`} title={`Mover para ${COLUMNS[ci + 1].label}`}>
                            <ChevronRight className="size-3.5" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {col.key !== "DONE" ? <QuickAdd column={col.key} weekKey={weekKey} /> : null}
            </section>
          );
        })}
      </div>
      {editing ? <EditDialog card={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function QuickAdd({ column, weekKey }: { column: Column; weekKey: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface hover:text-ink">
        <Plus className="size-4" aria-hidden /> Adicionar tarefa
      </button>
    );
  }
  return (
    <ActionForm action={createCardAction} resetOnSuccess className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <Hidden name="week" value={weekKey} />
      <Hidden name="column" value={column} />
      <TextField name="title" label="Tarefa" required maxLength={200} placeholder="O que precisa ser feito?" />
      <div className="grid grid-cols-2 gap-2">
        <SelectField name="priority" label="Prioridade" options={PRIORITY_OPTIONS} defaultValue="NORMAL" />
        <TextField name="dueDate" label="Prazo" type="date" />
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn-sm">Adicionar</SubmitButton>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Fechar</button>
      </div>
      <FormMessage />
    </ActionForm>
  );
}

function EditDialog({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(520px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold">Editar tarefa</h2>
        <button type="button" className="btn btn-ghost btn-sm px-2" onClick={() => ref.current?.close()} aria-label="Fechar">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <ActionForm action={withClose(updateCardAction, onClose)} className="flex flex-col gap-4">
          <Hidden name="id" value={card.id} />
          <TextField name="title" label="Tarefa" required maxLength={200} defaultValue={card.title} />
          <TextAreaField name="description" label="Detalhes" rows={4} maxLength={4000} defaultValue={card.description} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField name="priority" label="Prioridade" options={PRIORITY_OPTIONS} defaultValue={card.priority} />
            <TextField name="dueDate" label="Prazo" type="date" defaultValue={card.dueDate} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton>Salvar</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
        <ActionForm action={withClose(deleteCardAction, onClose)} className="border-t border-line pt-4">
          <Hidden name="id" value={card.id} />
          <SubmitButton variant="ghost" className="btn-sm text-danger" confirm="Excluir esta tarefa?">Excluir tarefa</SubmitButton>
        </ActionForm>
      </div>
    </dialog>
  );
}

/** Fecha o diálogo quando a ação dá certo. */
function withClose(action: (s: ActionState, fd: FormData) => Promise<ActionState>, close: () => void) {
  return async (s: ActionState, fd: FormData) => {
    const r = await action(s, fd);
    if (r.ok) close();
    return r;
  };
}
