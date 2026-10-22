import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { toDateKey } from "@/lib/dates";
import { TASK_PRIORITY, TASK_STATUS, options } from "@/lib/labels";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";

type Opt = Array<{ value: string; label: string; group?: string }>;

export function TaskForm({
  action,
  defaults,
  assignees,
  employees,
  meetings,
  feedbacks,
  cancelHref,
  submitLabel,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: {
    title?: string;
    description?: string | null;
    priority?: string;
    status?: string;
    dueDate?: Date | null;
    assignee?: string;
    employeeId?: string | null;
    meetingId?: string | null;
    feedbackId?: string | null;
  };
  assignees: Opt;
  employees: Opt;
  meetings: Opt;
  feedbacks: Opt | null;
  cancelHref: string;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="panel grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
      <TextField name="title" label="Título" required defaultValue={defaults.title} className="md:col-span-2" maxLength={200} />
      <TextAreaField name="description" label="Descrição" defaultValue={defaults.description} className="md:col-span-2" rows={4} maxLength={4000} />
      <SelectField name="priority" label="Prioridade" options={options(TASK_PRIORITY)} defaultValue={defaults.priority ?? "MEDIUM"} />
      <SelectField name="status" label="Status" options={options(TASK_STATUS)} defaultValue={defaults.status ?? "PENDING"} />
      <TextField name="dueDate" label="Prazo" type="date" defaultValue={defaults.dueDate ? toDateKey(defaults.dueDate) : ""} />
      <SelectField name="assignee" label="Responsável" options={assignees} defaultValue={defaults.assignee} placeholder="Sem responsável" />
      <fieldset className="grid grid-cols-1 gap-6 border-t border-dashed border-cork pt-6 md:col-span-2 md:grid-cols-2">
        <legend className="sr-only">Vínculos</legend>
        <SelectField name="employeeId" label="Colaborador relacionado (opcional)" options={employees} defaultValue={defaults.employeeId} placeholder="Nenhum" />
        <SelectField name="meetingId" label="Reunião relacionada (opcional)" options={meetings} defaultValue={defaults.meetingId} placeholder="Nenhuma" />
        {feedbacks ? <SelectField name="feedbackId" label="Feedback relacionado (opcional)" options={feedbacks} defaultValue={defaults.feedbackId} placeholder="Nenhum" /> : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">Cancelar</Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
