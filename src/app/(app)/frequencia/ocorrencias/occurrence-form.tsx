import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { formatTime, toDateKey } from "@/lib/dates";
import { REVIEW_STATUS, options } from "@/lib/labels";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { FileField } from "@/components/ui/file-field";

type Defaults = {
  employeeId?: string;
  typeId?: string;
  date?: Date;
  startMinute?: number | null;
  endMinute?: number | null;
  adminNotes?: string | null;
  restrictedNotes?: string | null;
  reviewStatus?: string;
};

export function OccurrenceForm({
  action,
  employees,
  types,
  defaults,
  canRestricted,
  isEdit,
  cancelHref,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  employees: Array<{ value: string; label: string }>;
  types: Array<{ id: string; name: string; requiresTimeRange: boolean; isMedical: boolean; code: string }>;
  defaults: Defaults;
  canRestricted: boolean;
  isEdit: boolean;
  cancelHref: string;
}) {
  const typeOptions = types
    .filter((t) => t.code !== "TROCA_PLANTAO" && t.code !== "AJUSTE_ESCALA")
    .map((t) => ({ value: t.id, label: `${t.name}${t.requiresTimeRange ? " — exige horário" : ""}` }));
  return (
    <ActionForm action={action} className="panel grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
      <SelectField name="employeeId" label="Colaborador" required options={employees} defaultValue={defaults.employeeId} placeholder="Selecione…" />
      <SelectField name="typeId" label="Tipo de ocorrência" required options={typeOptions} defaultValue={defaults.typeId} placeholder="Selecione…" />
      <TextField name="date" label="Data do turno" type="date" required defaultValue={defaults.date ? toDateKey(defaults.date) : ""} hint="Para plantão noturno, use a data de início do plantão." />
      <div className="grid grid-cols-2 gap-4">
        <TextField name="startTime" label="Início" type="time" defaultValue={defaults.startMinute != null ? formatTime(defaults.startMinute) : ""} />
        <TextField name="endTime" label="Fim" type="time" defaultValue={defaults.endMinute != null ? formatTime(defaults.endMinute) : ""} />
        <p className="col-span-2 -mt-3 text-xs text-subtle">Deixe em branco para o turno inteiro. Fim menor que o início = dia seguinte.</p>
      </div>
      <TextAreaField name="adminNotes" label="Observação administrativa" defaultValue={defaults.adminNotes} className="md:col-span-2" rows={3} maxLength={2000} hint="Não registre diagnósticos ou detalhes de saúde aqui." />
      {canRestricted ? (
        <TextAreaField
          name="restrictedNotes"
          label="Informação restrita (opcional)"
          defaultValue={defaults.restrictedNotes}
          className="md:col-span-2"
          rows={2}
          maxLength={2000}
          hint="Visível apenas para perfis autorizados. Nunca aparece em pesquisas, relatórios ou na auditoria."
        />
      ) : null}
      <SelectField name="reviewStatus" label="Situação de conferência" options={options(REVIEW_STATUS)} defaultValue={defaults.reviewStatus ?? "PENDING"} />
      {canRestricted && !isEdit ? <FileField name="file" label="Anexo (PDF, PNG ou JPG — até 10 MB)" hint="Armazenamento privado; acesso somente autenticado." /> : <div />}
      {isEdit ? <TextAreaField name="reason" label="Motivo da correção" required className="md:col-span-2" rows={2} maxLength={500} hint="Obrigatório: os valores anteriores ficam registrados na auditoria." /> : null}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{isEdit ? "Salvar correção" : "Registrar ocorrência"}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">Cancelar</Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
