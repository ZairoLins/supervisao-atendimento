import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, LineChart, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { addMonths, endOfMonth, formatDate, formatMonth, formatMonthLong, monthKey, parseMonthKey, startOfMonth, toDateKey } from "@/lib/dates";
import { pickEnum, readParams, safeDateParam } from "@/lib/validation";
import { listMetrics, metricSeries, pctChange, peerComparison, periodAggregate, weekLabel, weekStartOf, weeklySeries } from "@/modules/metrics/service";
import { distinctTeamsAndTitles, employeeOptions } from "@/modules/employees/service";
import { EmptyState, PageHeader, Pagination, Panel, Stat, buildHref } from "@/components/ui/primitives";
import { MetricTrend } from "@/components/charts/metric-trend";

export const metadata: Metadata = { title: "Desempenho" };

function monthOr(v: string | undefined, fallback: Date) {
  try {
    return v ? parseMonthKey(v) : fallback;
  } catch {
    return fallback;
  }
}

const fmt = (n: number | null, d = 2) => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (a: number | null, b: number | null) => {
  const p = pctChange(a, b);
  return p === null ? "—" : `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
};

export default async function PerformancePage(props: PageProps<"/desempenho">) {
  const actor = await requirePermission("metrics:read");
  const params = readParams(await props.searchParams);
  const t = today();
  const month = monthOr(params.mes, startOfMonth(t));
  const months = Number(pickEnum(params.meses, ["6", "12", "24"] as const) ?? "12");
  const employeeId = params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador) ? params.colaborador : undefined;
  const scope = { employeeId, team: employeeId ? undefined : params.team, jobTitle: employeeId ? undefined : params.funcao };

  // Comparação entre períodos (datas livres). Padrão: mês selecionado vs. mês anterior.
  const aFrom = safeDateParam(params.aDe) ?? startOfMonth(month);
  const aTo = safeDateParam(params.aAte) ?? endOfMonth(month);
  const bFrom = safeDateParam(params.bDe) ?? startOfMonth(addMonths(month, -1));
  const bTo = safeDateParam(params.bAte) ?? endOfMonth(addMonths(month, -1));

  const [employees, { teams, titles }, weekly, monthly, teamMonthly, monthTotal, A, B, peers, list] = await Promise.all([
    employeeOptions(db, actor, { includeInactive: true }),
    distinctTeamsAndTitles(db),
    weeklySeries(db, actor, { weeks: 12, end: month.getTime() === startOfMonth(t).getTime() ? t : endOfMonth(month), ...scope }),
    metricSeries(db, actor, { months, end: month, ...scope }),
    employeeId ? metricSeries(db, actor, { months, end: month }) : Promise.resolve(null),
    periodAggregate(db, actor, { from: startOfMonth(month), to: endOfMonth(month), ...scope }),
    periodAggregate(db, actor, { from: aFrom, to: aTo, ...scope }),
    periodAggregate(db, actor, { from: bFrom, to: bTo, ...scope }),
    peerComparison(db, actor, { month, team: params.team, jobTitle: params.funcao }),
    listMetrics(db, actor, { employeeId, team: params.team, from: startOfMonth(month), to: endOfMonth(month), page: Number(params.page) || 1 }),
  ]);
  const selectedName = employees.find((e) => e.value === employeeId)?.label;
  const scopeLabel = selectedName ?? (params.team || params.funcao ? [params.team, params.funcao].filter(Boolean).join(" · ") : "Toda a equipe");
  const monthlyData = monthly.map((s, i) => ({ ...s, compareTickets: null, compareAht: teamMonthly?.[i]?.aht ?? null, compareRating: teamMonthly?.[i]?.rating ?? null }));
  const nav = (m: Date) => buildHref("/desempenho", params, { mes: monthKey(m), page: undefined, aDe: undefined, aAte: undefined, bDe: undefined, bAte: undefined });

  return (
    <>
      <PageHeader
        eyebrow="Indicadores semanais"
        title="Desempenho"
        description="Lançamentos feitos semana a semana (a semana conta no mês da sua sexta-feira). Volume maior não significa, por si só, melhor desempenho."
        actions={can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-primary"><Plus className="size-4" aria-hidden /> Lançar métricas da semana</Link> : null}
      />

      <form method="get" className="panel-tight mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="p-mes">Mês</label>
          <input id="p-mes" type="month" name="mes" defaultValue={monthKey(month)} className="input w-40" />
        </div>
        <div>
          <label className="label" htmlFor="p-col">Colaborador</label>
          <select id="p-col" name="colaborador" defaultValue={employeeId ?? ""} className="input w-56">
            <option value="">Toda a equipe</option>
            {employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-team">Equipe</label>
          <select id="p-team" name="team" defaultValue={params.team ?? ""} className="input w-44">
            <option value="">Todas</option>
            {teams.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-fn">Função</label>
          <select id="p-fn" name="funcao" defaultValue={params.funcao ?? ""} className="input w-44">
            <option value="">Todas</option>
            {titles.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <input type="hidden" name="meses" value={String(months)} />
        <button type="submit" className="btn btn-secondary">Aplicar</button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={`Chamados em ${formatMonth(month)}`} value={monthTotal.tickets?.toLocaleString("pt-BR") ?? "—"} hint={scopeLabel} />
        <Stat label="Tempo médio" value={monthTotal.aht === null ? "—" : `${fmt(monthTotal.aht)} min`} hint="Ponderado pelos chamados" />
        <Stat label="Avaliação média" value={fmt(monthTotal.rating)} hint="Escala de 0 a 10" />
        <Stat label="Semanas com lançamento" value={monthTotal.weeks} hint={`${monthTotal.count} lançamento(s) no mês`} />
      </div>

      <div className="grid grid-cols-1 gap-5">
        <Panel
          title="Semana a semana — últimas 12 semanas"
          description={scopeLabel}
          actions={
            <div className="flex gap-1">
              <Link href={nav(addMonths(month, -1))} className="btn btn-secondary btn-sm">Mês anterior</Link>
              {month.getTime() < startOfMonth(t).getTime() ? <Link href={nav(addMonths(month, 1))} className="btn btn-secondary btn-sm">Próximo mês</Link> : null}
            </div>
          }
        >
          {weekly.every((w) => w.tickets === null) ? (
            <EmptyState
              icon={<LineChart className="size-5" />}
              title="Nenhum lançamento nas últimas semanas"
              description="Use “Lançar métricas da semana” para registrar os indicadores da equipe."
              action={can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-primary">Lançar métricas</Link> : null}
            />
          ) : (
            <MetricTrend data={weekly} primaryLabel={selectedName ?? "Equipe"} height={240} />
          )}
        </Panel>

        <Panel
          title="Evolução mensal"
          description={selectedName ? `${selectedName} (linha azul) vs. média da equipe (tracejada)` : scopeLabel}
          actions={
            <div className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
              {["6", "12", "24"].map((m) => (
                <Link key={m} href={buildHref("/desempenho", params, { meses: m })} className={`rounded-md px-3 py-1 text-[13px] font-medium ${String(months) === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                  {m} meses
                </Link>
              ))}
            </div>
          }
        >
          {monthly.some((s) => s.tickets !== null) ? (
            <MetricTrend data={monthlyData} primaryLabel={selectedName ?? "Equipe"} compareLabel={selectedName ? "Média da equipe" : undefined} />
          ) : (
            <p className="text-sm text-muted">Sem lançamentos nos últimos {months} meses.</p>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Comparar períodos" description="Escolha dois intervalos de datas (contam as semanas cuja sexta-feira cai no intervalo).">
            <form method="get" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {employeeId ? <input type="hidden" name="colaborador" value={employeeId} /> : null}
              {params.team ? <input type="hidden" name="team" value={params.team} /> : null}
              {params.funcao ? <input type="hidden" name="funcao" value={params.funcao} /> : null}
              <input type="hidden" name="mes" value={monthKey(month)} />
              <div><label className="label" htmlFor="a-de">A — de</label><input id="a-de" type="date" name="aDe" defaultValue={toDateKey(aFrom)} className="input" /></div>
              <div><label className="label" htmlFor="a-ate">A — até</label><input id="a-ate" type="date" name="aAte" defaultValue={toDateKey(aTo)} className="input" /></div>
              <div><label className="label" htmlFor="b-de">B — de</label><input id="b-de" type="date" name="bDe" defaultValue={toDateKey(bFrom)} className="input" /></div>
              <div><label className="label" htmlFor="b-ate">B — até</label><input id="b-ate" type="date" name="bAte" defaultValue={toDateKey(bTo)} className="input" /></div>
              <button type="submit" className="btn btn-secondary btn-sm col-span-2 justify-self-start sm:col-span-4">Comparar</button>
            </form>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Indicador</th><th className="text-right">A</th><th className="text-right">B</th><th className="text-right">A vs. B</th></tr></thead>
                <tbody>
                  <tr><td>Chamados</td><td className="text-right tabular-nums">{fmt(A.tickets, 0)}</td><td className="text-right tabular-nums">{fmt(B.tickets, 0)}</td><td className="text-right tabular-nums">{pct(A.tickets, B.tickets)}</td></tr>
                  <tr><td>Tempo médio (min)</td><td className="text-right tabular-nums">{fmt(A.aht)}</td><td className="text-right tabular-nums">{fmt(B.aht)}</td><td className="text-right tabular-nums">{pct(A.aht, B.aht)}</td></tr>
                  <tr><td>Avaliação</td><td className="text-right tabular-nums">{fmt(A.rating)}</td><td className="text-right tabular-nums">{fmt(B.rating)}</td><td className="text-right tabular-nums">{pct(A.rating, B.rating)}</td></tr>
                  <tr><td className="text-subtle">Semanas com lançamento</td><td className="text-right text-subtle">{A.weeks}</td><td className="text-right text-subtle">{B.weeks}</td><td /></tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-subtle">A: {formatDate(aFrom)} a {formatDate(aTo)} · B: {formatDate(bFrom)} a {formatDate(bTo)}</p>
          </Panel>

          <Panel title={`Colaboradores no mês — ${formatMonth(month)}`} description="Mesma equipe/função (use os filtros acima). Lado a lado, sem ranking.">
            {peers.length === 0 ? (
              <p className="text-sm text-muted">Sem lançamentos neste mês para o filtro escolhido.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Colaborador</th><th className="text-right">Semanas</th><th className="text-right">Chamados</th><th className="text-right">TMA</th><th className="text-right">Avaliação</th></tr></thead>
                  <tbody>
                    {peers.map((p) => (
                      <tr key={p.employee.id}>
                        <td>
                          <Link className="link" href={buildHref("/desempenho", {}, { colaborador: p.employee.id, mes: monthKey(month) })}>{p.employee.fullName}</Link>
                          <span className="block text-xs text-subtle">{p.jobTitle} · {p.team}</span>
                        </td>
                        <td className="text-right tabular-nums">{p.weeks}</td>
                        <td className="text-right tabular-nums">{p.tickets?.toLocaleString("pt-BR")}</td>
                        <td className="text-right tabular-nums">{fmt(p.aht)}</td>
                        <td className="text-right tabular-nums">{fmt(p.rating)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title={`Lançamentos de ${formatMonthLong(month)}`}>
          {list.total === 0 ? (
            <p className="text-sm text-muted">Nenhum lançamento neste mês.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Semana</th><th>Colaborador</th><th className="text-right">Chamados</th><th className="text-right">TMA (min)</th><th className="text-right">Avaliação</th><th>Histórico</th></tr>
                  </thead>
                  <tbody>
                    {list.items.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap"><Link className="link" href={`/desempenho/${m.id}`}>{weekLabel(m.weekStart)}</Link></td>
                        <td>{m.employee.fullName}</td>
                        <td className="text-right tabular-nums">{m.ticketsHandled.toLocaleString("pt-BR")}</td>
                        <td className="text-right tabular-nums">{fmt(Number(m.avgHandleMinutes))}</td>
                        <td className="text-right tabular-nums">{fmt(Number(m.avgRating))}</td>
                        <td className="text-xs text-subtle">{m._count.revisions ? `${m._count.revisions} correção(ões)` : "Original"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination base="/desempenho" params={params} page={list.page} pageCount={list.pageCount} total={list.total} />
            </>
          )}
          {can(actor, "metrics:write") ? (
            <span className="mt-4 flex flex-wrap gap-4 text-sm"><Link href="/desempenho/lancar" className="link-accent">Lançar a semana atual</Link>{can(actor, "reports:export") ? <a href={`/api/relatorios?tipo=semanal&formato=pdf&semana=${toDateKey(weekStartOf(t))}`} target="_blank" rel="noopener" className="link-accent inline-flex items-center gap-1"><FileDown className="size-3.5" aria-hidden /> Relatório da semana atual (PDF)</a> : null}</span>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
