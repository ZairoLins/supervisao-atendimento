import type { Metadata } from "next";
import Link from "next/link";
import { LineChart, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { addMonths, formatMonth, monthKey, parseMonthKey, startOfMonth } from "@/lib/dates";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams } from "@/lib/validation";
import { aggregate, listMetrics, metricSeries, pctChange, peerComparison, type PeriodAggregate } from "@/modules/metrics/service";
import { distinctTeamsAndTitles, employeeOptions } from "@/modules/employees/service";
import { EmptyState, PageHeader, Pagination, Panel, SortHeader } from "@/components/ui/primitives";
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
  const months = Number(pickEnum(params.meses, ["6", "12", "24"] as const) ?? "12");
  const employeeId = params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador) ? params.colaborador : undefined;
  const end = startOfMonth(t);
  const peerMonth = monthOr(params.mesComparacao, addMonths(end, -1));
  // Comparação entre períodos: A (atual) vs. B (anterior de mesmo tamanho), ajustáveis
  const aEnd = monthOr(params.aAte, end);
  const aStart = monthOr(params.aDe, addMonths(aEnd, -2));
  const bEnd = monthOr(params.bAte, addMonths(aStart, -1));
  const bStart = monthOr(params.bDe, addMonths(bEnd, -2));
  const span = (s: Date, e: Date) => Math.max(1, Math.min(36, (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1));

  const [employees, { teams, titles }, series, teamSeries, periodA, periodB, peers, list] = await Promise.all([
    employeeOptions(db, actor, { includeInactive: true }),
    distinctTeamsAndTitles(db),
    metricSeries(db, actor, { months, end, employeeId, team: employeeId ? undefined : params.team, jobTitle: employeeId ? undefined : params.funcao }),
    employeeId ? metricSeries(db, actor, { months, end }) : Promise.resolve(null),
    metricSeries(db, actor, { months: span(aStart, aEnd), end: aEnd, employeeId, team: params.team, jobTitle: params.funcao }),
    metricSeries(db, actor, { months: span(bStart, bEnd), end: bEnd, employeeId, team: params.team, jobTitle: params.funcao }),
    peerComparison(db, actor, { month: peerMonth, team: params.team, jobTitle: params.funcao }),
    listMetrics(db, actor, {
      employeeId,
      team: params.team,
      page: pageParam(params),
      sort: params.sort,
      dir: pickEnum(params.dir, ["asc", "desc"] as const),
    }),
  ]);
  const data = series.map((s, i) => ({ ...s, compareTickets: null, compareAht: teamSeries?.[i]?.aht ?? null, compareRating: teamSeries?.[i]?.rating ?? null }));
  const hasData = series.some((s) => s.tickets !== null);
  const A: PeriodAggregate = aggregate(periodA);
  const B: PeriodAggregate = aggregate(periodB);
  const selectedName = employees.find((e) => e.value === employeeId)?.label;

  return (
    <>
      <PageHeader
        eyebrow="Indicadores mensais"
        title="Desempenho"
        description="Valores lançados manualmente por mês. Volume maior não significa, por si só, melhor desempenho — leia os indicadores em conjunto e com contexto."
        actions={can(actor, "metrics:write") ? <Link href={`/desempenho/lancar${employeeId ? `?colaborador=${employeeId}` : ""}`} className="btn btn-primary"><Plus className="size-3.5" aria-hidden /> Lançar métricas</Link> : null}
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="p-col">Colaborador</label>
          <select id="p-col" name="colaborador" defaultValue={employeeId ?? ""} className="input w-60">
            <option value="">Equipe (todos)</option>
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
        <fieldset className="flex items-end gap-1" aria-label="Janela histórica">
          {["6", "12", "24"].map((m) => (
            <label key={m} className={`btn btn-sm cursor-pointer ${String(months) === m ? "btn-primary" : "btn-ghost"}`}>
              <input type="radio" name="meses" value={m} defaultChecked={String(months) === m} className="sr-only" />
              {m} meses
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn btn-secondary">Aplicar</button>
      </form>

      <div className="grid grid-cols-1 gap-[18px]">
        <Panel title={`Evolução — ${months} meses`} description={selectedName ? `${selectedName} (linha contínua) vs. média da equipe (tracejada)` : params.team || params.funcao ? "Equipe filtrada" : "Equipe inteira"}>
          {hasData ? (
            <MetricTrend data={data} primaryLabel={selectedName ?? "Equipe"} compareLabel={selectedName ? "Média da equipe" : undefined} height={300} />
          ) : (
            <EmptyState icon={<LineChart className="size-6" />} title="Nenhum lançamento no período" description="Lance os indicadores mensais para gerar os gráficos." action={can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-primary">Lançar métricas</Link> : null} />
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
          <Panel title="Comparação entre períodos" description="Mesmos filtros acima. Valores agregados de cada período.">
            <form method="get" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {employeeId ? <input type="hidden" name="colaborador" value={employeeId} /> : null}
              {params.team ? <input type="hidden" name="team" value={params.team} /> : null}
              {params.funcao ? <input type="hidden" name="funcao" value={params.funcao} /> : null}
              <div><label className="label" htmlFor="a-de">A — de</label><input id="a-de" type="month" name="aDe" defaultValue={monthKey(aStart)} className="input" /></div>
              <div><label className="label" htmlFor="a-ate">A — até</label><input id="a-ate" type="month" name="aAte" defaultValue={monthKey(aEnd)} className="input" /></div>
              <div><label className="label" htmlFor="b-de">B — de</label><input id="b-de" type="month" name="bDe" defaultValue={monthKey(bStart)} className="input" /></div>
              <div><label className="label" htmlFor="b-ate">B — até</label><input id="b-ate" type="month" name="bAte" defaultValue={monthKey(bEnd)} className="input" /></div>
              <button type="submit" className="btn btn-secondary btn-sm col-span-2 justify-self-start sm:col-span-4">Comparar</button>
            </form>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Indicador</th><th className="text-right">A · {formatMonth(aStart)}–{formatMonth(aEnd)}</th><th className="text-right">B · {formatMonth(bStart)}–{formatMonth(bEnd)}</th><th className="text-right">Variação A vs. B</th></tr></thead>
                <tbody>
                  <tr><td>Chamados</td><td className="text-right tabular-nums">{fmt(A.tickets, 0)}</td><td className="text-right tabular-nums">{fmt(B.tickets, 0)}</td><td className="text-right tabular-nums">{pct(A.tickets, B.tickets)}</td></tr>
                  <tr><td>Tempo médio (min)</td><td className="text-right tabular-nums">{fmt(A.aht)}</td><td className="text-right tabular-nums">{fmt(B.aht)}</td><td className="text-right tabular-nums">{pct(A.aht, B.aht)}</td></tr>
                  <tr><td>Avaliação média</td><td className="text-right tabular-nums">{fmt(A.rating)}</td><td className="text-right tabular-nums">{fmt(B.rating)}</td><td className="text-right tabular-nums">{pct(A.rating, B.rating)}</td></tr>
                  <tr><td className="text-subtle">Meses com registro</td><td className="text-right text-subtle">{A.months}</td><td className="text-right text-subtle">{B.months}</td><td /></tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Colaboradores em contexto equivalente" description="Mesma equipe/função no mês (filtros acima). Lado a lado, sem ranking.">
            <form method="get" className="mb-5 flex items-end gap-3">
              {params.team ? <input type="hidden" name="team" value={params.team} /> : null}
              {params.funcao ? <input type="hidden" name="funcao" value={params.funcao} /> : null}
              <div><label className="label" htmlFor="pc-mes">Mês</label><input id="pc-mes" type="month" name="mesComparacao" defaultValue={monthKey(peerMonth)} className="input" /></div>
              <button type="submit" className="btn btn-secondary btn-sm">Ver</button>
            </form>
            {!params.team && !params.funcao ? <p className="mb-4 text-xs text-warn">Selecione equipe e/ou função acima para comparar contextos equivalentes.</p> : null}
            {peers.length === 0 ? (
              <p className="text-sm text-muted">Sem lançamentos em {formatMonth(peerMonth)} para este contexto.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Colaborador</th><th>Função · equipe</th><th className="text-right">Chamados</th><th className="text-right">TMA</th><th className="text-right">Avaliação</th></tr></thead>
                  <tbody>
                    {peers.map((m) => (
                      <tr key={m.id}>
                        <td><Link className="link" href={`/desempenho/${m.id}`}>{m.employee.fullName}</Link></td>
                        <td className="text-xs text-muted">{m.jobTitleSnapshot} · {m.teamSnapshot}</td>
                        <td className="text-right tabular-nums">{m.ticketsHandled.toLocaleString("pt-BR")}</td>
                        <td className="text-right tabular-nums">{fmt(Number(m.avgHandleMinutes))}</td>
                        <td className="text-right tabular-nums">{fmt(Number(m.avgRating))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Lançamentos">
          {list.total === 0 ? (
            <EmptyState title="Nenhum lançamento" description="Os lançamentos mensais aparecerão aqui, com o histórico de correções." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeader base="/desempenho" params={params} field="month">Mês</SortHeader>
                      <SortHeader base="/desempenho" params={params} field="employee">Colaborador</SortHeader>
                      <SortHeader base="/desempenho" params={params} field="tickets" className="text-right">Chamados</SortHeader>
                      <SortHeader base="/desempenho" params={params} field="aht" className="text-right">TMA (min)</SortHeader>
                      <SortHeader base="/desempenho" params={params} field="rating" className="text-right">Avaliação</SortHeader>
                      <th>Histórico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap"><Link className="link" href={`/desempenho/${m.id}`}>{formatMonth(m.month)}</Link></td>
                        <td>{m.employee.fullName}<span className="block text-xs text-subtle">{formatCode("employee", m.employee.code)}</span></td>
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
        </Panel>
      </div>
    </>
  );
}
