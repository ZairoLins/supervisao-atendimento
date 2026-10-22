import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/dal";
import { readParams } from "@/lib/validation";
import { createTaskAction } from "@/modules/tasks/actions";
import { PageHeader } from "@/components/ui/primitives";
import { TaskForm } from "../task-form";
import { taskFormOptions } from "../options";

export const metadata: Metadata = { title: "Nova tarefa" };

export default async function NewTaskPage(props: PageProps<"/tarefas/nova">) {
  const actor = await requirePermission("tasks:write");
  const params = readParams(await props.searchParams);
  const opts = await taskFormOptions(actor, { employeeId: params.colaborador, feedbackId: params.feedback });
  return (
    <>
      <PageHeader eyebrow="Tarefas e pendências" title="Nova tarefa" />
      <TaskForm
        action={createTaskAction}
        defaults={{ employeeId: params.colaborador, meetingId: params.reuniao, feedbackId: params.feedback, assignee: `user:${actor.id}` }}
        {...opts}
        cancelHref="/tarefas"
        submitLabel="Criar tarefa"
      />
    </>
  );
}
