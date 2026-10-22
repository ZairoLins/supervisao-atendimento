import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatCode } from "@/lib/text";
import { getTask } from "@/modules/tasks/service";
import { updateTaskAction } from "@/modules/tasks/actions";
import { PageHeader } from "@/components/ui/primitives";
import { TaskForm } from "../../task-form";
import { taskFormOptions } from "../../options";

export const metadata: Metadata = { title: "Editar tarefa" };

export default async function EditTaskPage(props: PageProps<"/tarefas/[id]/editar">) {
  const actor = await requirePermission("tasks:write");
  const id = assertUuid((await props.params).id);
  const task = await orNotFound(getTask(db, actor, id));
  const opts = await taskFormOptions(actor, { employeeId: task.employeeId, feedbackId: task.feedbackId });
  const assignee = task.assigneeUserId ? `user:${task.assigneeUserId}` : task.assigneeEmployeeId ? `employee:${task.assigneeEmployeeId}` : undefined;
  return (
    <>
      <PageHeader eyebrow={formatCode("task", task.code)} title="Editar tarefa" description="Cada campo alterado é registrado no histórico da tarefa." />
      <TaskForm action={updateTaskAction.bind(null, id)} defaults={{ ...task, assignee }} {...opts} cancelHref={`/tarefas/${id}`} submitLabel="Salvar alterações" />
    </>
  );
}
