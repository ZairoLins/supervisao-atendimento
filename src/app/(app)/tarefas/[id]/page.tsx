import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { assertUuid, orNotFound, today } from "@/lib/page";
import { formatDate, formatDateTime } from "@/lib/dates";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getTask, isOverdue } from "@/modules/tasks/service";
import { deleteTaskAction, setTaskStatusAction } from "@/modules/tasks/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton } from "@/components/ui/form";
import { Badge, DescriptionList, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Tarefa" };

export default async function TaskPage(props: PageProps<"/tarefas/[id]">) {
  const actor = await requirePermission("tasks:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const task = await orNotFound(getTask(db, actor, id));
  const t = today();
  const tz = env().APP_TIMEZONE;
  const canWrite = can(actor, "tasks:write");

  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("task", task.code)} · Tarefas`}
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LabelBadge map={TASK_STATUS} value={task.status} />
            <LabelBadge map={TASK_PRIORITY} value={task.priority} />
            {isOverdue(task, t) ? <Badge tone="danger">Atrasada</Badge> : null}
          </span>
        }
        actions={canWrite ? <Link href={`/tarefas/${id}/editar`} className="btn btn-secondary"><Pencil className="size-3.5" aria-hidden /> Editar</Link> : null}
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Tarefa salva.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-[18px]">
          <Panel title="Detalhes">
            <DescriptionList
              items={[
                { label: "Prazo", value: task.dueDate ? formatDate(task.dueDate) : "Sem prazo" },
                { label: "Responsável", value: task.assigneeEmployee ? <Link className="link" href={`/colaboradores/${task.assigneeEmployee.id}`}>{task.assigneeEmployee.fullName}</Link> : task.assigneeUser?.name ?? "—" },
                { label: "Criada em", value: formatDateTime(task.createdAt, tz) },
                { label: "Concluída em", value: task.completedAt ? formatDateTime(task.completedAt, tz) : "—" },
                {
                  label: "Colaborador relacionado",
                  value: task.employee ? <Link className="link" href={`/colaboradores/${task.employee.id}?aba=tarefas`}>{task.employee.fullName}</Link> : "—",
                },
                {
                  label: "Reunião relacionada",
                  value: task.meeting ? (task.meeting.deletedAt ? `${task.meeting.title} (excluída)` : <Link className="link" href={`/reunioes/${task.meeting.id}`}>{task.meeting.title} · {formatDate(task.meeting.date)}</Link>) : "—",
                },
                ...(task.feedback
                  ? [{ label: "Feedback relacionado", value: task.feedback.deletedAt ? "Feedback excluído" : <Link className="link" href={`/feedbacks/${task.feedback.id}`}>{formatCode("feedback", task.feedback.code)} · {formatDate(task.feedback.date)}</Link> }]
                  : []),
              ]}
            />
            <hr className="divider my-6" />
            <p className="eyebrow mb-2">Descrição</p>
            <p className="whitespace-pre-line text-sm text-muted">{task.description || "—"}</p>
          </Panel>
          <Panel title="Histórico de alterações">
            <ol className="flex flex-col gap-3 text-sm">
              {task.events.map((e) => (
                <li key={e.id} className="border-b border-dashed border-cork pb-3 last:border-0 last:pb-0">
                  <p>{e.field === "created" ? `Tarefa criada (${e.toValue})` : <>{e.field}: <span className="text-subtle">{e.fromValue ?? "—"}</span> → {e.toValue ?? "—"}</>}</p>
                  <p className="mt-0.5 text-xs text-subtle">{formatDateTime(e.createdAt, tz)} · {e.user?.name ?? "Sistema"}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        {canWrite ? (
          <div className="flex flex-col gap-[18px]">
            <Panel title="Atualizar status">
              <div className="flex flex-wrap gap-2">
                {(["PENDING", "IN_PROGRESS", "DONE", "CANCELED"] as const).filter((s) => s !== task.status).map((s) => (
                  <ActionForm key={s} action={setTaskStatusAction.bind(null, id)}>
                    <Hidden name="status" value={s} />
                    <SubmitButton variant={s === "DONE" ? "primary" : "secondary"} className="btn-sm">{TASK_STATUS[s].label}</SubmitButton>
                  </ActionForm>
                ))}
              </div>
            </Panel>
            <Panel title="Excluir">
              <ActionForm action={deleteTaskAction.bind(null, id)} className="flex flex-col gap-3">
                <p className="text-xs text-subtle">Exclusão lógica, registrada na auditoria.</p>
                <SubmitButton variant="danger" className="btn-sm self-start" confirm="Excluir esta tarefa?">Excluir tarefa</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
