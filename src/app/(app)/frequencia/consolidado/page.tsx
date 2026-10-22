import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { dayNumber, endOfMonth, formatDate, formatDuration, startOfMonth, toDateKey } from "@/lib/dates";
import { readParams, safeDateParam } from "@/lib/validation";
import { teamAttendanceSummary } from "@/modules/attendance/occurrences";
import { distinctTeamsAndTitles } from "@/modules/employees/service";
import { Badge, EmptyState, Notice, PageHeader, Panel } from "@/components/ui/primitives";
import { AttendanceNav } from "../nav";

export const metadata: Metadata = { title: "Consolidado de horas" };

export default async function ConsolidatedPage(props: PageProps<"/frequencia/consolidado">) {
  const actor = await requirePermission("attendance:read");
  const params = readParams(await props.searchParams);
  const t = today();
  let from = safeDateParam(params.de) ?? startOfMonth(t);
  let to = safeDateParam(params.ate) ?? endOfMonth(t);
  if (dayNumber(from) > dayNumber(to)) [from, to] = [to, from];
  const tooLong = dayNumber(to) - dayNumber(from) > 370;
  if (tooLong) to = new Date(from.getTime() + 370 * 86_400_000);
  const [rows, { teams }] = await Promise.all([teamAttendanceSummary(db, actor, from, to, { team: params.team }), distinctTeamsAndTitles(db)]);
  const totals = rows.reduce((acc, r) => ({ planned: acc.planned + r.summary.plannedMinutes, absence: acc.absence + r.summary.absenceMinutes }), { planned: 0, absence: 0 });

  return (
    <>
      <PageHeader eyebrow="Frequência e escalas" title="Consolidado de horas" description="Horas previstas pela escala efetiva e ausências registradas, por colaborador. Ferramenta de acompanhamento: não calcula descontos." />
      <AttendanceNav active="consolidado" />
      {tooLong ? <div className="mb-6"><Notice tone="warn">Período limitado a 12 meses.</Notice></div> : null}
      <Panel>
        <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
          <div><label className="label" htmlFor="c-de">De</label><input id="c-de" type="date" name="de" defaultValue={toDateKey(from)} className="input" /></div>
          <div><label className="label" htmlFor="c-ate">Até</label><input id="c-ate" type="date" name="ate" defaultValue={toDateKey(to)} className="input" /></div>
          <div>
            <label className="label" htmlFor="c-team">Equipe</label>
            <select id="c-team" name="team" defaultValue={params.team ?? ""} className="input w-48">
              <option value="">Todas</option>
              {teams.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary">Calcular</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum colaborador ativo" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Colaborador</th><th className="text-right">Turnos</th><th className="text-right">Previsto</th><th className="text-right">Ausências</th><th className="text-right">Estimado trabalhado</th><th>Ocorrências</th><th>Atenção</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id}>
                    <td><Link className="link" href={`/frequencia/escala/${r.employee.id}`}>{r.employee.fullName}</Link><span className="block text-xs text-subtle">{r.employee.team}</span></td>
                    <td className="text-right tabular-nums">{r.summary.plannedDays}</td>
                    <td className="text-right tabular-nums">{formatDuration(r.summary.plannedMinutes)}</td>
                    <td className="text-right tabular-nums">{formatDuration(r.summary.absenceMinutes)}</td>
                    <td className="text-right tabular-nums">{formatDuration(r.summary.workedEstimateMinutes)}</td>
                    <td className="text-xs text-muted">{Object.entries(r.byType).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</td>
                    <td className="flex flex-wrap gap-1">
                      {r.summary.plannedMinutes === 0 ? <Badge tone="warn">Sem escala</Badge> : null}
                      {r.pendingReview ? <Badge tone="warn">{r.pendingReview} a conferir</Badge> : null}
                      {r.summary.outsideSchedule.length ? <Badge tone="info">{r.summary.outsideSchedule.length} fora da escala</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="px-3 py-3 text-xs font-medium uppercase">Total</td>
                  <td />
                  <td className="px-3 py-3 text-right tabular-nums">{formatDuration(totals.planned)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatDuration(totals.absence)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatDuration(Math.max(0, totals.planned - totals.absence))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-subtle">Período: {formatDate(from)} a {formatDate(to)}. Intervalos não computáveis (ex.: almoço) não entram no previsto; ausências sobrepostas são contadas uma única vez.</p>
      </Panel>
    </>
  );
}
