import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { formatTime } from "@/lib/dates";
import { WEEKDAYS_SHORT } from "@/lib/labels";
import { ActionForm, CheckboxField, CheckboxGroup, FormMessage, SelectField, SubmitButton, TextField } from "@/components/ui/form";

type Defaults = {
  name?: string;
  description?: string | null;
  kind?: "WEEKLY" | "ROTATION";
  weekdays?: number[];
  cycleDays?: number | null;
  workOffsets?: number[];
  segments?: Array<{ startMinute: number; endMinute: number; weekday?: number | null }>;
  active?: boolean;
};

export function ScheduleForm({
  action,
  defaults = {},
  locked = false,
  isEdit = false,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: Defaults;
  /** Jornada já atribuída: horários bloqueados para preservar o histórico */
  locked?: boolean;
  isEdit?: boolean;
}) {
  const general = (defaults.segments ?? []).filter((s) => s.weekday === null || s.weekday === undefined);
  const seg = (i: number, k: "startMinute" | "endMinute") => {
    const s = general[i];
    return s ? formatTime(s[k]) : "";
  };
  const day = (wd: number, k: "startMinute" | "endMinute") => {
    const s = defaults.segments?.find((x) => x.weekday === wd);
    return s ? formatTime(s[k]) : "";
  };
  return (
    <ActionForm action={action} className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <TextField name="name" label="Nome" required defaultValue={defaults.name} className="md:col-span-2" maxLength={120} />
      <TextField name="description" label="Descrição" defaultValue={defaults.description} className="md:col-span-2" maxLength={500} />
      {locked ? (
        <p className="text-sm text-muted md:col-span-2">
          Esta jornada já foi atribuída a colaboradores. Para preservar o histórico, os horários e a regra não podem ser alterados — crie uma nova jornada e atribua com nova data de vigência.
        </p>
      ) : (
        <>
          <SelectField
            name="kind"
            label="Tipo de jornada"
            defaultValue={defaults.kind ?? "WEEKLY"}
            options={[
              { value: "WEEKLY", label: "Semanal fixa (dias da semana)" },
              { value: "ROTATION", label: "Revezamento em ciclo (ex.: 12x36)" },
            ]}
            className="md:col-span-2"
          />
          <div className="md:col-span-2">
            <CheckboxGroup
              name="weekdays"
              label="Dias da semana (jornada semanal)"
              columns={7}
              options={WEEKDAYS_SHORT.map((d, i) => ({ value: String(i), label: d }))}
              defaultValues={(defaults.weekdays ?? [1, 2, 3, 4, 5]).map(String)}
            />
          </div>
          <TextField name="cycleDays" label="Tamanho do ciclo em dias (revezamento)" type="number" min={2} max={14} defaultValue={defaults.cycleDays ?? ""} hint="12x36 = 2 dias (trabalha 1, folga 1)." />
          <TextField name="workOffsets" label="Posições de trabalho no ciclo" defaultValue={(defaults.workOffsets ?? [0]).join(",")} hint="0 = data de referência. Ex.: 0 para 12x36." />
          <fieldset className="md:col-span-2">
            <legend className="label">Períodos computáveis (intervalos entre períodos não contam)</legend>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
              <TextField name="start1" label="Início 1" type="time" defaultValue={seg(0, "startMinute")} />
              <TextField name="end1" label="Fim 1" type="time" defaultValue={seg(0, "endMinute")} />
              <TextField name="start2" label="Início 2" type="time" defaultValue={seg(1, "startMinute")} />
              <TextField name="end2" label="Fim 2" type="time" defaultValue={seg(1, "endMinute")} />
              <TextField name="start3" label="Início 3" type="time" defaultValue={seg(2, "startMinute")} />
              <TextField name="end3" label="Fim 3" type="time" defaultValue={seg(2, "endMinute")} />
            </div>
            <p className="mt-2 text-xs text-subtle">Fim menor que o início indica término no dia seguinte (ex.: 19:00–07:00).</p>
          </fieldset>
          <fieldset className="rounded-xl bg-surface-2 p-4 md:col-span-2">
            <legend className="sr-only">Horário diferente no fim de semana</legend>
            <p className="mb-3 text-sm font-medium">Horário diferente no fim de semana (opcional, jornada semanal)</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <TextField name="satStart" label="Sábado — início" type="time" defaultValue={day(6, "startMinute")} />
              <TextField name="satEnd" label="Sábado — fim" type="time" defaultValue={day(6, "endMinute")} />
              <TextField name="sunStart" label="Domingo — início" type="time" defaultValue={day(0, "startMinute")} />
              <TextField name="sunEnd" label="Domingo — fim" type="time" defaultValue={day(0, "endMinute")} />
            </div>
            <p className="mt-2 text-xs text-subtle">Preencha para o dia ter um horário próprio (ex.: sábado 08:00–12:00). O dia passa a fazer parte da jornada automaticamente.</p>
          </fieldset>
        </>
      )}
      {isEdit ? <CheckboxField name="active" label="Jornada ativa (disponível para novas atribuições)" defaultChecked={defaults.active ?? true} /> : null}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{isEdit ? "Salvar jornada" : "Criar jornada"}</SubmitButton>
        {isEdit ? <Link href="/frequencia/jornadas" className="btn btn-ghost">Cancelar</Link> : null}
        <FormMessage />
      </div>
    </ActionForm>
  );
}
