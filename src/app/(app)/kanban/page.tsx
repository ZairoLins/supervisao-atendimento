import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { addDays, dayNumber, toDateKey } from "@/lib/dates";
import { readParams, safeDateParam } from "@/lib/validation";
import { weekLabel, weekStartOf } from "@/modules/metrics/service";
import { listBoard } from "@/modules/kanban/service";
import { carryOverAction } from "@/modules/kanban/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/primitives";
import { KanbanBoard } from "./board";

export const metadata: Metadata = { title: "Minha semana" };

export default async function KanbanPage(props: PageProps<"/kanban">) {
  const actor = await requirePermission("kanban:manage");
  const params = readParams(await props.searchParams);
  const t = today();
  const currentWeek = weekStartOf(t);
  const board = await listBoard(db, actor, safeDateParam(params.semana) ?? t);
  const key = toDateKey(board.weekStart);
  const isCurrent = dayNumber(board.weekStart) === dayNumber(currentWeek);
  const nav = (ws: Date) => `/kanban?semana=${toDateKey(ws)}`;
  const done = board.cards.filter((c) => c.column === "DONE").length;

  return (
    <>
      <PageHeader
        eyebrow="Kanban"
        title="Minha semana"
        description="Suas tarefas da semana: arraste entre as colunas (ou use as setas do cartão) para acompanhar o andamento."
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={nav(addDays(board.weekStart, -7))} className="btn btn-secondary btn-sm px-2" aria-label="Semana anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <div className="rounded-lg border border-line bg-surface px-4 py-1.5 text-center">
            <p className="text-sm font-semibold">Semana {weekLabel(board.weekStart)}</p>
            <p className="text-xs text-subtle">{isCurrent ? "semana atual" : "segunda a domingo"}</p>
          </div>
          <Link href={nav(addDays(board.weekStart, 7))} className="btn btn-secondary btn-sm px-2" aria-label="Próxima semana">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
          {!isCurrent ? <Link href="/kanban" className="btn btn-ghost btn-sm">Semana atual</Link> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {board.cards.length ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((done / board.cards.length) * 100)}%` }} />
              </span>
              {done} de {board.cards.length} concluída(s)
            </div>
          ) : null}
          {board.pendingBefore > 0 ? (
            <ActionForm action={carryOverAction} className="flex items-center gap-2">
              <Hidden name="week" value={key} />
              <SubmitButton variant="secondary" className="btn-sm">
                <History className="size-3.5" aria-hidden /> Trazer {board.pendingBefore} pendência(s) anteriores
              </SubmitButton>
              <FormMessage />
            </ActionForm>
          ) : null}
        </div>
      </div>
      <KanbanBoard
        weekKey={key}
        todayKey={toDateKey(t)}
        cards={board.cards.map((c) => ({ id: c.id, title: c.title, description: c.description, column: c.column, priority: c.priority, dueDate: c.dueDate ? toDateKey(c.dueDate) : null }))}
      />
    </>
  );
}
