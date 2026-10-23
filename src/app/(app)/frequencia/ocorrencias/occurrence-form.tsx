"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { formatTime, toDateKey } from "@/lib/dates";
import { REVIEW_STATUS, options } from "@/lib/labels";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { FileField } from "@/components/ui/file-field";

type TimeMode = "NONE" | "ARRIVAL" | "DEPARTURE" | "RANGE";

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

const MODE_HINT: Record<TimeMode, string> = {
  NONE: "Vale para o turno inteiro do dia.",
  ARRIVAL: "Informe só a hora em que o colaborador chegou. O início do turno vem da escala dele.",
  DEPARTURE: "Informe só a hora em que o colaborador saiu. O fim do turno vem da escala dele.",
  RANGE: "Informe o início e o fim da ausência. Fim menor que o início = dia seguinte.",
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
  types: Array<{ id: string; name: string; timeMode: TimeMode; code: string }>;
  defaults: Defaults;
  canRestricted: boolean;
  isEdit: boolean;
  cancelHref: string;
}) {
  const selectable = types.filter((t) => t.code !== "TROCA_PLANTAO" && t.code !== "AJUSTE_ESCALA");
  const [typeId, setTypeId] = useState(defaults.typeId ?? "");
  const mode: TimeMode = selectable.find((t) => t.id === typeId)?.timeMode ?? "NONE";
  const fmt = (m: number | null | undefined) => (m === null || m === undefined ? "" : formatTime(m));
  const singleDefault = mode === "ARRIVAL" ? fmt(defaults.endMinute) : mode === "DEPARTURE" ? fmt(defaults.startMinute) : "";

  return (
    <ActionForm action={action} className="panel grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
      <SelectField name="employeeId" label="Colaborador" required options={employees} defaultValue={defaults.employeeId} placeholder="Selecione…" />
      <SelectField
        name="typeId"
        label="Tipo de ocorrência"
        required
        options={selectable.map((t) => ({ value: t.id, label: t.name }))}
        defaultValue={defaults.typeId}
        placeholder="Selecione…"
        onChange={setTypeId}
      />
      <TextField name="date" label="Data" type="date" required defaultValue={defaults.date ? toDateKey(defaults.date) : ""} hint="Para plantão noturno, use a data em que o plantão começou." />

      <div className="rounded-xl bg-primary-soft/60 p-4 md:row-span-2">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-primary-ink">
          <Clock className="size-4" aria-hidden /> Horário
        </p>
        {mode === "ARRIVAL" ? (
          <TextField key="arrival" name="time" label="Hora que chegou" type="time" required defaultValue={singleDefault} />
        ) : mode === "DEPARTURE" ? (
          <TextField key="departure" name="time" label="Hora que saiu" type="time" required defaultValue={singleDefault} />
        ) : mode === "RANGE" ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField name="startTime" label="Início" type="time" required defaultValue={fmt(defaults.startMinute)} />
            <TextField name="endTime" label="Fim" type="time" required defaultValue={fmt(defaults.endMinute)} />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted">{typeId ? MODE_HINT[mode] : "Escolha o tipo de ocorrência."}</p>
      </div>

      <SelectField name="reviewStatus" label="Situação de conferência" options={options(REVIEW_STATUS)} defaultValue={defaults.reviewStatus ?? "PENDING"} />
      <TextAreaField name="adminNotes" label="Observação" defaultValue={defaults.adminNotes} className="md:col-span-2" rows={3} maxLength={2000} hint="Não registre diagnósticos ou detalhes de saúde aqui." />
      {canRestricted ? (
        <TextAreaField
          name="restrictedNotes"
          label="Informação restrita (opcional)"
          defaultValue={defaults.restrictedNotes}
          className="md:col-span-2"
          rows={2}
          maxLength={2000}
          hint="Visível só para perfis autorizados. Não aparece em pesquisas, relatórios ou na auditoria."
        />
      ) : null}
      {canRestricted && !isEdit ? <FileField name="file" label="Anexo (PDF, PNG ou JPG — até 10 MB)" hint="Armazenamento privado." /> : null}
      {isEdit ? <TextAreaField name="reason" label="Motivo da correção" required className="md:col-span-2" rows={2} maxLength={500} hint="Obrigatório: os valores anteriores ficam registrados na auditoria." /> : null}
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{isEdit ? "Salvar correção" : "Registrar ocorrência"}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">Cancelar</Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
