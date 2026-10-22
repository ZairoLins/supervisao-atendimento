import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound, today } from "@/lib/page";
import { addMonths, formatDate, formatDuration, formatMonthLong, formatTimeRange, monthKey, parseMonthKey, startOfMonth, toDateKey, weekday } from "@/lib/dates";
import { ADJUSTMENT_KIND, WEEKDAYS_SHORT } from "@/lib/labels";
import { readParams } from "@/lib/validation";
import { getEmployee, employeeOptions } from "@/modules/employees/service";
import { employeeCalendar } from "@/modules/attendance/occurrences";
import { createAdjustmentAction, endAssignmentAction, revokeAdjustmentAction } from "@/modules/attendance/actions";
import { ActionForm, FormMessage, Hidden, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, EmptyState, PageHeader, Panel, Stat, cx } from "@/components/ui/primitives";
import { AttendanceNav } from "../../nav";

export const metadata: Metadata = { title: "Escala do colaborador" };

export default async function EmployeeScalePage(props: PageProps<"/frequencia/escala/[id]">) {
  const actor = await requirePermission("attendance:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const t = today();
  let month = startOfMonth(t);
  try {
    if (params.mes) month = parseMonthKey(params.mes);
  } catch {
    /* mês inválido: usa o atual */
  }
  const employee = await orNotFound(getEmployee(db, actor, id));
  const [cal, colleagues] = await Promise.all([employeeCalendar(db, actor, id, month), employeeOptions(db, actor)]);
  const canWrite = can(actor, "attendance:write");
  const leading = weekday(cal.days[0].date);
  const todayKey = toDateKey(t);

  return (
    <>
      <PageHeader
        eyebrow="Escala / calendário"
        title={employee.fullName}
        description={`${employee.jobTitle} · ${employee.team}`}
        actions={<Link href={`/colaboradores/${id}?aba=frequencia`} className="btn btn-ghost">Perfil</Link>}
      />
      <AttendanceNav active="escala" />

      <div className="mb-[18px] grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        <Stat label="Turnos previstos (efetivos)" value={cal.summary.plannedDays} hint={`${cal.summary.offDays} dia(s) de folga`} />
        <Stat label="Horas previstas" value={formatDuration(cal.summary.plannedMinutes)} />
        <Stat label="Ausências" value={formatDuration(cal.summary.absenceMinutes)} hint="Sem dupla contagem" />
        <Stat label="Dias ajustados" value={cal.summary.adjustedDays} />
      </div>

      <div className="grid grid-cols-1 gap-[18px] 2xl:grid-cols-[3fr_1fr]">
        <Panel
          title={formatMonthLong(month)}
          actions={
            <div className="flex gap-2">
              <Link className="btn btn-ghost btn-sm" href={`/frequencia/escala/${id}?mes=${monthKey(addMonths(month, -1))}`} aria-label="Mês anterior"><ChevronLeft className="size-4" aria-hidden /></Link>
              <Link className="btn btn-ghost btn-sm" href={`/frequencia/escala/${id}?mes=${monthKey(t)}`}>Hoje</Link>
              <Link className="btn btn-ghost btn-sm" href={`/frequencia/escala/${id}?mes=${monthKey(addMonths(month, 1))}`} aria-label="Próximo mês"><ChevronRight className="size-4" aria-hidden /></Link>
            </div>
          }
        >
          {cal.assignments.length === 0 ? (
            <div className="mb-4">
              <EmptyState
                title="Sem jornada atribuída"
                description="Atribua uma jornada para gerar o calendário de turnos e folgas."
                action={canWrite ? <Link href={`/frequencia/jornadas?colaborador=${id}`} className="btn btn-primary">Atribuir jornada</Link> : null}
              />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-1.5" role="grid" aria-label={`Calendário de ${formatMonthLong(month)}`}>
              {WEEKDAYS_SHORT.map((d) => (
                <div key={d} role="columnheader" className="eyebrow pb-1 text-center">{d}</div>
              ))}
              {Array.from({ length: leading }).map((_, i) => <div key={`b${i}`} aria-hidden />)}
              {cal.days.map((d) => {
                const changed = d.adjustment !== null;
                return (
                  <div
                    key={d.dateKey}
                    role="gridcell"
                    className={cx(
                      "min-h-24 rounded-[10px] border p-2 text-[11px]",
                      d.effective.isWorkDay ? "border-driftwood bg-surface-2" : "border-dashed border-cork",
                      d.dateKey === todayKey && "outline outline-1 outline-ember",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm tabular-nums">{d.date.getUTCDate()}</span>
                      <span className="text-subtle">{d.effective.isWorkDay ? "Turno" : "Folga"}</span>
                    </div>
                    {d.effective.segments.map((s, i) => (
                      <p key={i} className="mt-1 tabular-nums text-muted">{formatTimeRange(s.startMinute, s.endMinute)}</p>
                    ))}
                    {changed ? (
                      <p className="mt-1 text-info">
                        Ajuste · previsto: {d.planned.isWorkDay ? d.planned.segments.map((s) => formatTimeRange(s.startMinute, s.endMinute)).join(", ") : "folga"}
                      </p>
                    ) : null}
                    {d.occurrences.map((o) => (
                      <Link key={o.id} href={`/frequencia/ocorrencias/${o.id}`} className={cx("mt-1 block truncate underline-offset-2 hover:underline", o.reviewStatus === "DISREGARDED" ? "text-subtle line-through" : "text-warn")}>
                        {o.typeName}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-4 text-xs text-subtle">Borda contínua = dia de turno; tracejada = folga. Ajustes mostram também a escala prevista original.</p>
        </Panel>

        <div className="flex flex-col gap-[18px]">
          {canWrite && cal.assignments.length > 0 ? (
            <Panel title="Troca ou ajuste" description="Não apaga a escala prevista.">
              <ActionForm action={createAdjustmentAction} resetOnSuccess className="flex flex-col gap-5">
                <Hidden name="employeeId" value={id} />
                <TextField name="date" label="Data" type="date" required defaultValue={toDateKey(t)} />
                <SelectField
                  name="kind"
                  label="Tipo"
                  options={[
                    { value: "DAY_OFF", label: "Folga (ou cessão do turno na troca)" },
                    { value: "CUSTOM_HOURS", label: "Trabalhar em horário específico" },
                  ]}
                  defaultValue="DAY_OFF"
                />
                <div className="grid grid-cols-2 gap-4">
                  <TextField name="startTime" label="Início" type="time" />
                  <TextField name="endTime" label="Fim" type="time" />
                </div>
                <SelectField
                  name="swapWithEmployeeId"
                  label="Troca com (opcional)"
                  options={colleagues.filter((c) => c.value !== id)}
                  placeholder="Sem troca"
                  hint="O colega assume o turno desta data."
                />
                <TextAreaField name="reason" label="Motivo" required rows={2} maxLength={500} />
                <SubmitButton>Registrar</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          ) : null}

          <Panel title="Ajustes do mês">
            {cal.adjustments.length === 0 ? (
              <p className="text-sm text-muted">Nenhum ajuste neste mês.</p>
            ) : (
              <ul className="flex flex-col gap-4 text-sm">
                {cal.adjustments.map((a) => (
                  <li key={a.id} className="border-b border-dashed border-cork pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{formatDate(a.date)}</span>
                      <Badge tone={ADJUSTMENT_KIND[a.kind].tone}>{ADJUSTMENT_KIND[a.kind].label}</Badge>
                      {a.revokedAt ? <Badge tone="neutral">Revogado</Badge> : null}
                    </div>
                    {a.startMinute !== null && a.endMinute !== null ? <p className="mt-1 text-xs text-muted">{formatTimeRange(a.startMinute, a.endMinute)}</p> : null}
                    {a.swapWith ? <p className="mt-1 text-xs text-muted">Troca com {a.swapWith.fullName}</p> : null}
                    <p className="mt-1 text-xs text-subtle">{a.reason}</p>
                    {a.revokedReason ? <p className="mt-1 text-xs text-subtle">Revogação: {a.revokedReason}</p> : null}
                    {canWrite && !a.revokedAt ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium uppercase text-muted hover:text-cream">Revogar</summary>
                        <ActionForm action={revokeAdjustmentAction.bind(null, a.id)} className="mt-3 flex flex-col gap-3">
                          <TextField name="reason" label="Motivo da revogação" required maxLength={500} />
                          <SubmitButton variant="secondary" className="btn-sm self-start">Confirmar revogação</SubmitButton>
                          <FormMessage />
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Histórico de jornadas">
            {cal.assignments.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma jornada atribuída.</p>
            ) : (
              <ul className="flex flex-col gap-4 text-sm">
                {[...cal.assignments].reverse().map((a) => (
                  <li key={a.id} className="border-b border-dashed border-cork pb-4 last:border-0 last:pb-0">
                    <p>{a.schedule.name}</p>
                    <p className="mt-0.5 text-xs text-subtle">
                      {formatDate(a.validFrom)} — {a.validTo ? formatDate(a.validTo) : "atual"}
                      {a.cycleReferenceDate ? ` · referência do ciclo ${formatDate(a.cycleReferenceDate)}` : ""}
                    </p>
                    {canWrite && !a.validTo ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-medium uppercase text-muted hover:text-cream">Encerrar vigência</summary>
                        <ActionForm action={endAssignmentAction.bind(null, a.id)} className="mt-3 flex flex-col gap-3">
                          <TextField name="validTo" label="Último dia" type="date" required />
                          <SubmitButton variant="secondary" className="btn-sm self-start">Encerrar</SubmitButton>
                          <FormMessage />
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? <Link href={`/frequencia/jornadas?colaborador=${id}`} className="link mt-4 inline-block text-xs uppercase">Nova atribuição</Link> : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
