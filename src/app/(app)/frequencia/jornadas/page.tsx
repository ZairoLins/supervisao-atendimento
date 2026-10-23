import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { formatDate, formatDuration, formatTimeRange, toDateKey } from "@/lib/dates";
import { SCHEDULE_KIND, WEEKDAYS_SHORT } from "@/lib/labels";
import { readParams } from "@/lib/validation";
import { listSchedules } from "@/modules/attendance/schedules";
import { findAssignment, segmentMinutes } from "@/modules/attendance/rules";
import { employeeOptions } from "@/modules/employees/service";
import { assignScheduleAction, createScheduleAction } from "@/modules/attendance/actions";
import { ActionForm, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, EmptyState, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";
import { AttendanceNav } from "../nav";
import { ScheduleForm } from "./schedule-form";

export const metadata: Metadata = { title: "Jornadas e vigências" };

export default async function SchedulesPage(props: PageProps<"/frequencia/jornadas">) {
  const actor = await requirePermission("attendance:read");
  const params = readParams(await props.searchParams);
  const t = today();
  const [schedules, employees, assignments] = await Promise.all([
    listSchedules(db, actor),
    employeeOptions(db, actor),
    db.employeeScheduleAssignment.findMany({
      where: { employee: { status: { not: "INACTIVE" } } },
      include: { schedule: { select: { name: true } }, employee: { select: { id: true, fullName: true } } },
      orderBy: [{ employee: { fullName: "asc" } }, { validFrom: "asc" }],
    }),
  ]);
  const canWrite = can(actor, "attendance:write");
  const byEmployee = new Map<string, typeof assignments>();
  for (const a of assignments) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);

  return (
    <>
      <PageHeader eyebrow="Frequência e escalas" title="Jornadas e vigências" description="Modelos de jornada e o histórico de atribuição a cada colaborador. Uma nova atribuição encerra a anterior sem apagá-la." />
      <AttendanceNav active="jornadas" />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Jornada salva.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Modelos de jornada">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Jornada</th><th>Regra</th><th>Períodos</th><th className="text-right">Horas/turno</th><th>Uso</th></tr></thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {canWrite ? <Link href={`/frequencia/jornadas/${s.id}`} className="link">{s.name}</Link> : s.name}
                        {!s.active ? <span className="ml-2"><Badge tone="neutral">Inativa</Badge></span> : null}
                      </td>
                      <td className="text-muted">
                        <LabelBadge map={SCHEDULE_KIND} value={s.kind} />
                        <span className="mt-1 block text-xs">
                          {s.kind === "WEEKLY" ? s.weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ") : `Ciclo de ${s.cycleDays} dias · trabalho na posição ${s.workOffsets.join(", ")}`}
                        </span>
                      </td>
                      <td className="text-muted">
                        <span className="whitespace-nowrap">{s.segments.filter((g) => g.weekday === null).map((g) => formatTimeRange(g.startMinute, g.endMinute)).join(" · ")}</span>
                        {s.segments.filter((g) => g.weekday !== null).map((g) => (
                          <span key={g.id} className="block whitespace-nowrap text-xs">{WEEKDAYS_SHORT[g.weekday!]}: {formatTimeRange(g.startMinute, g.endMinute)}</span>
                        ))}
                      </td>
                      <td className="text-right tabular-nums">{formatDuration(segmentMinutes(s.segments.filter((g) => g.weekday === null)))}</td>
                      <td className="text-xs text-subtle">{s._count.assignments} atribuição(ões)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Jornada vigente por colaborador" description={`Situação em ${formatDate(t)}.`}>
            {employees.length === 0 ? (
              <EmptyState title="Nenhum colaborador ativo" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Colaborador</th><th>Jornada vigente</th><th>Desde</th><th>Histórico</th></tr></thead>
                  <tbody>
                    {employees.map((e) => {
                      const list = byEmployee.get(e.value) ?? [];
                      const current = findAssignment(list, t);
                      return (
                        <tr key={e.value}>
                          <td><Link className="link" href={`/frequencia/escala/${e.value}`}>{e.label}</Link></td>
                          <td>{current ? current.schedule.name : <Badge tone="warn">Sem jornada vigente</Badge>}</td>
                          <td className="whitespace-nowrap tabular-nums text-muted">{current ? formatDate(current.validFrom) : "—"}</td>
                          <td className="text-xs text-subtle">{list.length} vigência(s)</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {canWrite ? (
          <div className="flex flex-col gap-5">
            <Panel title="Atribuir jornada" description="Para 12x36, informe uma data em que o colaborador trabalha (referência do ciclo).">
              {employees.length === 0 ? (
                <p className="text-sm text-muted">Cadastre colaboradores primeiro.</p>
              ) : (
                <ActionForm action={assignScheduleAction} resetOnSuccess className="flex flex-col gap-5">
                  <SelectField name="employeeId" label="Colaborador" required options={employees} placeholder="Selecione…" defaultValue={params.colaborador} />
                  <SelectField name="scheduleId" label="Jornada" required options={schedules.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} placeholder="Selecione…" />
                  <TextField name="validFrom" label="Início da vigência" type="date" required defaultValue={toDateKey(t)} />
                  <TextField name="cycleReferenceDate" label="Data de referência do ciclo (12x36)" type="date" hint="Obrigatória para revezamento: um dia de plantão." />
                  <TextAreaField name="notes" label="Observação" rows={2} maxLength={500} />
                  <SubmitButton>Atribuir</SubmitButton>
                  <FormMessage />
                </ActionForm>
              )}
            </Panel>
            <Panel title="Nova jornada">
              <ScheduleForm action={createScheduleAction} />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}

