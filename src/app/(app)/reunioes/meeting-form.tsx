import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { formatTime, toDateKey } from "@/lib/dates";
import { MEETING_STATUS, MEETING_TYPE, options } from "@/lib/labels";
import { ActionForm, CheckboxGroup, FormMessage, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { MarkdownField } from "@/components/ui/markdown-field";

type Defaults = {
  title?: string;
  type?: string;
  status?: string;
  date?: Date;
  startMinute?: number;
  endMinute?: number | null;
  location?: string | null;
  participantIds?: string[];
  agenda?: string;
};

export const AGENDA_HINT = "Markdown: **negrito**, *itálico*, ## títulos, listas e \"- [ ] item\" para checklist (marcado na reunião como discutido).";
const AGENDA_PLACEHOLDER = "## Abertura\n- [ ] Recados da semana\n\n## Indicadores\n- [ ] Chamados e avaliações\n- [ ] **Pontos de atenção**";

export function MeetingForm({
  action,
  defaults,
  employees,
  templates,
  previousMeetings,
  isEdit,
  cancelHref,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: Defaults;
  employees: Array<{ value: string; label: string }>;
  templates?: Array<{ value: string; label: string }>;
  previousMeetings?: Array<{ value: string; label: string }>;
  isEdit: boolean;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="panel grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
      <TextField name="title" label="Título" required defaultValue={defaults.title} className="md:col-span-2" maxLength={160} />
      <SelectField name="type" label="Tipo" options={options(MEETING_TYPE)} defaultValue={defaults.type ?? "EXTRAORDINARY"} />
      {isEdit ? <SelectField name="status" label="Situação" options={options(MEETING_STATUS)} defaultValue={defaults.status} /> : <div className="hidden md:block" />}
      <TextField name="date" label="Data" type="date" required defaultValue={defaults.date ? toDateKey(defaults.date) : ""} />
      <div className="grid grid-cols-2 gap-4">
        <TextField name="startTime" label="Início" type="time" required defaultValue={defaults.startMinute !== undefined ? formatTime(defaults.startMinute) : "09:00"} />
        <TextField name="endTime" label="Término" type="time" defaultValue={defaults.endMinute != null ? formatTime(defaults.endMinute) : ""} />
      </div>
      <TextField name="location" label="Local ou link" defaultValue={defaults.location} className="md:col-span-2" maxLength={160} />
      <div className="md:col-span-2">
        <CheckboxGroup name="participantIds" label="Participantes" options={employees} defaultValues={defaults.participantIds ?? []} columns={3} />
      </div>
      <fieldset className="grid grid-cols-1 gap-6 border-t border-line pt-6 md:col-span-2 md:grid-cols-2">
        <legend className="sr-only">Pauta planejada</legend>
        <MarkdownField
          name="agenda"
          label="Pauta planejada"
          rows={10}
          maxLength={20000}
          defaultValue={defaults.agenda}
          placeholder={AGENDA_PLACEHOLDER}
          className="md:col-span-2"
          hint={isEdit ? AGENDA_HINT : `${AGENDA_HINT} Se vazio, a pauta pode vir de um modelo ou de uma reunião anterior.`}
        />
        {!isEdit && templates?.length ? <SelectField name="templateId" label="Usar modelo" options={templates} placeholder="Nenhum" /> : null}
        {!isEdit && previousMeetings?.length ? <SelectField name="copyFromMeetingId" label="Reutilizar pauta de reunião anterior" options={previousMeetings} placeholder="Nenhuma" /> : null}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{isEdit ? "Salvar reunião" : "Criar reunião"}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">Cancelar</Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
