import Link from "next/link";
import type { ActionState } from "@/lib/action";
import { toDateKey } from "@/lib/dates";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";

type Defaults = {
  fullName?: string;
  jobTitle?: string;
  team?: string;
  startDate?: Date;
  status?: string;
  workloadLabel?: string | null;
  generalNotes?: string | null;
};

export function EmployeeForm({
  action,
  defaults = {},
  teams,
  titles,
  cancelHref,
  submitLabel,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: Defaults;
  teams: string[];
  titles: string[];
  cancelHref: string;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="panel grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
      <TextField name="fullName" label="Nome completo" required defaultValue={defaults.fullName} className="md:col-span-2" maxLength={160} />
      <TextField name="jobTitle" label="Função" required defaultValue={defaults.jobTitle} list="titles" hint="Ex.: Atendente, Estagiário, Plantonista." maxLength={100} />
      <TextField name="team" label="Equipe ou setor" required defaultValue={defaults.team} list="teams" maxLength={100} />
      <TextField name="startDate" label="Data de entrada" type="date" required defaultValue={defaults.startDate ? toDateKey(defaults.startDate) : ""} />
      <SelectField
        name="status"
        label="Situação"
        defaultValue={defaults.status === "INACTIVE" ? "ACTIVE" : (defaults.status ?? "ACTIVE")}
        options={[
          { value: "ACTIVE", label: "Ativo" },
          { value: "ON_LEAVE", label: "Afastado" },
        ]}
        hint="Para inativar, use a ação Inativar no perfil."
      />
      <TextField
        name="workloadLabel"
        label="Jornada de trabalho (descrição)"
        defaultValue={defaults.workloadLabel}
        className="md:col-span-2"
        hint="Texto livre de referência. O cálculo de horas usa a jornada atribuída em Frequência e escalas."
        maxLength={120}
      />
      <TextAreaField
        name="generalNotes"
        label="Observações profissionais gerais"
        defaultValue={defaults.generalNotes}
        className="md:col-span-2"
        hint="Registre apenas informações profissionais, objetivas e necessárias à supervisão."
        maxLength={4000}
      />
      <datalist id="teams">
        {teams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="titles">
        {titles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">
          Cancelar
        </Link>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
