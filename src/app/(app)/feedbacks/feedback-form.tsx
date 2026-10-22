import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { toDateKey } from "@/lib/dates";
import { FEEDBACK_STATUS, FEEDBACK_TYPE, options } from "@/lib/labels";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";

type Defaults = {
  employeeId?: string;
  date?: Date;
  type?: string;
  context?: string;
  positives?: string | null;
  improvements?: string | null;
  agreedActions?: string | null;
  followUpDate?: Date | null;
  status?: string;
  reviewDate?: Date | null;
};

export function FeedbackForm({
  action,
  defaults,
  employees,
  cancelHref,
  submitLabel,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: Defaults;
  employees: Array<{ value: string; label: string }>;
  cancelHref: string;
  submitLabel: string;
}) {
  const d = (v?: Date | null) => (v ? toDateKey(v) : "");
  return (
    <ActionForm action={action} className="panel grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
      <SelectField name="employeeId" label="Colaborador" required options={employees} defaultValue={defaults.employeeId} placeholder="Selecione…" />
      <TextField name="date" label="Data" type="date" required defaultValue={d(defaults.date)} />
      <SelectField name="type" label="Tipo de feedback" options={options(FEEDBACK_TYPE)} defaultValue={defaults.type ?? "ALIGNMENT"} />
      <SelectField name="status" label="Situação" options={options(FEEDBACK_STATUS)} defaultValue={defaults.status ?? "OPEN"} />
      <TextAreaField name="context" label="Contexto profissional" required rows={3} defaultValue={defaults.context} className="md:col-span-2" maxLength={2000} hint="Situação de trabalho observada, de forma objetiva e factual." />
      <TextAreaField name="positives" label="Pontos positivos" rows={4} defaultValue={defaults.positives} maxLength={4000} />
      <TextAreaField name="improvements" label="Pontos a desenvolver" rows={4} defaultValue={defaults.improvements} maxLength={4000} />
      <TextAreaField name="agreedActions" label="Ações acordadas" rows={3} defaultValue={defaults.agreedActions} className="md:col-span-2" maxLength={4000} />
      <TextField name="followUpDate" label="Prazo de acompanhamento" type="date" defaultValue={d(defaults.followUpDate)} />
      <TextField name="reviewDate" label="Data de revisão" type="date" defaultValue={d(defaults.reviewDate)} />
      <p className="text-xs text-subtle md:col-span-2">Registre apenas aspectos profissionais. Evite informações pessoais, de saúde ou impressões que possam ser discriminatórias.</p>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">Cancelar</Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
