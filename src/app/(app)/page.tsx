import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarPlus, ClipboardList, FileWarning, LineChart, MessageSquareText, UserPlus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { addDays, addMonths, formatDate, formatMonth, formatTime, monthKey, monthRange, parseMonthKey, startOfMonth, toDateKey } from "@/lib/dates";
import { agendaStats } from "@/lib/markdown";
import { readParams } from "@/lib/validation";
import { loadDashboard } from "@/modules/dashboard/service";
import { pctChange, weekStartOf } from "@/modules/metrics/service";
import { employeeOptions } from "@/modules/employees/service";
import { Badge, EmptyState, Panel, Stat } from "@/components/ui/primitives";
import { CountBars, MetricTrend } from "@/components/charts/metric-trend";

export const metadata: Metadata = { title: "Visão geral" };

const longDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

function safeMonth(v: string | undefined, fallback: Date) {
  try {
    return v ? parseMonthKey(v) : fallback;
  } catch {
    return fallback;
  }
}

/** Variação informativa: não classifica o resultado como bom ou ruim. */
function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  const pct = pctChange(current, previous);
  if (pct === null) return <span>Sem base de comparação</span>;
  return (
    <span>
      {pct > 0 ? "+" : ""}
      {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior
    </span>
  );
}

export default async function DashboardPage(props: PageProps<"/">) {
  const actor = await requireActor();
  const params = readParams(await props.searchParams);
  const t = today();
  const defaultTo = startOfMonth(t);
  let toMonth = safeMonth(params.ate, defaultTo);
  let fromMonth = safeMonth(params.de, addMonths(defaultTo, -5));
  if (fromMonth > toMonth) [fromMonth, toMonth] = [toMonth, fromMonth];
  if (monthRange(fromMonth, toMonth).length > 24) fromMonth = addMonths(toMonth, -23);
  const employeeId = params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador) ? params.colaborador : undefined;

  const [data, employees] = await Promise.all([
    loadDashboard(db, actor, { fromMonth, toMonth, employeeId }, t),
    can(actor, "employees:read") ? employeeOptions(db, actor, { includeInactive: true }) : Promise.resolve([]),
  ]);
  const hasMetrics = data.metrics ? data.metrics.series.some((s) => s.tickets !== null) : false;
  const periodLabel = `${formatMonth(fromMonth)} – ${formatMonth(toMonth)}`;
  const lastWeek = addDays(weekStartOf(t), -7);
  const attention =
    (data.attendance?.pendingReview ?? 0) + (data.followUps?.length ?? 0) + (data.withoutSchedule?.length ?? 0) + (data.metrics?.missingLastWeek.length ?? 0);

  const shortcuts = [
    can(actor, "metrics:write") && { href: "/desempenho/lancar", label: "Lançar métricas da semana", icon: LineChart },
    can(actor, "attendance:write") && { href: "/frequencia/ocorrencias/nova", label: "Registrar ocorrência", icon: FileWarning },
    can(actor, "employees:write") && { href: "/colaboradores/novo", label: "Novo colaborador", icon: UserPlus },
    can(actor, "meetings:write") && { href: "/reunioes/nova", label: "Nova reunião", icon: CalendarPlus },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof UserPlus }>;

  return (
    <>
      <header className="mb-8 flex flex-col gap-6 border-b border-line pb-7 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="eyebrow mb-3">{longDate.format(t)}</p>
          <h1 className="display">
            Olá, <em className="text-primary">{actor.name.split(" ")[0]}</em>
          </h1>
          <p className="mt-3 text-[14.5px] text-muted">Resumo da equipe com base nos registros do sistema.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2.5">
          <div>
            <label htmlFor="d-de" className="label">De</label>
            <input id="d-de" type="month" name="de" defaultValue={monthKey(fromMonth)} className="input w-[150px]" />
          </div>
          <div>
            <label htmlFor="d-ate" className="label">Até</label>
            <input id="d-ate" type="month" name="ate" defaultValue={monthKey(toMonth)} className="input w-[150px]" />
          </div>
          {employees.length ? (
            <div>
              <label htmlFor="d-col" className="label">Colaborador</label>
              <select id="d-col" name="colaborador" defaultValue={employeeId ?? ""} className="input w-52">
                <option value="">Toda a equipe</option>
                {employees.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="submit" className="btn btn-secondary">Aplicar</button>
        </form>
      </header>

      {shortcuts.length ? (
        <nav aria-label="Atalhos" className="mb-6 flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2">Atalhos</span>
          {shortcuts.map((s) => (
            <Link key={s.href} href={s.href} className="group inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface py-1.5 pr-3.5 pl-2.5 text-[13.5px] font-medium transition-colors hover:border-ink hover:bg-ink hover:text-white">
              <s.icon className="size-4 text-subtle transition-colors group-hover:text-white" strokeWidth={1.75} aria-hidden />
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-label="Indicadores" className="stat-strip mb-6 grid-cols-2 lg:grid-cols-5">
        {data.activeEmployees !== null ? (
          <Stat label="Colaboradores ativos" value={data.activeEmployees} hint={`${data.totalEmployees} cadastrados`} href="/colaboradores" />
        ) : null}
        {data.attendance ? (
          <Stat label="Ocorrências" value={data.attendance.occurrences} hint={<Delta current={data.attendance.occurrences} previous={data.attendance.previous} />} href="/frequencia" />
        ) : null}
        {data.metrics ? (
          <>
            <Stat
              label="Chamados atendidos"
              value={data.metrics.current.tickets?.toLocaleString("pt-BR") ?? "—"}
              hint={data.metrics.current.tickets === null ? "Sem lançamentos no período" : <Delta current={data.metrics.current.tickets} previous={data.metrics.previous.tickets} />}
              href="/desempenho"
            />
            <Stat
              label="Avaliação média"
              value={data.metrics.current.rating?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "—"}
              hint={data.metrics.current.rating === null ? "Sem lançamentos no período" : "Escala de 0 a 10"}
              href="/desempenho"
            />
            <Stat
              label="Tempo médio de atendimento"
              value={data.metrics.current.aht === null ? "—" : `${data.metrics.current.aht.toLocaleString("pt-BR")} min`}
              hint={data.metrics.current.aht === null ? "Sem lançamentos no período" : "Ponderado pelos chamados"}
              href="/desempenho"
            />
          </>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        {data.metrics ? (
          <Panel title="Evolução mensal" description={`${periodLabel} · ${employeeId ? "colaborador selecionado" : "toda a equipe"}`}>
            {hasMetrics ? (
              <MetricTrend data={data.metrics.series} primaryLabel={employeeId ? "Colaborador" : "Equipe"} />
            ) : (
              <EmptyState
                icon={<LineChart className="size-5" />}
                title="Nenhuma métrica no período"
                description="Os gráficos usam apenas lançamentos reais. Lance as métricas da semana para acompanhar a evolução."
                action={can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-primary">Lançar métricas</Link> : null}
              />
            )}
          </Panel>
        ) : null}

        <Panel title="Precisa de atenção" actions={attention ? <Badge tone="warn">{attention}</Badge> : undefined}>
          {attention === 0 ? (
            <div className="flex items-center gap-3 rounded-r-lg border-l-2 border-ok bg-ok-soft p-4 text-sm text-ok">
              <ClipboardList className="size-5" aria-hidden /> Nada pendente no momento.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.metrics?.missingLastWeek.length ? (
                <li className="flex items-start gap-3 py-3 first:pt-0">
                  <LineChart className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="text-sm">
                    <Link href={`/desempenho/lancar?semana=${toDateKey(lastWeek)}`} className="link">
                      {data.metrics.missingLastWeek.length} colaborador(es) sem métricas da semana passada
                    </Link>
                    <span className="block text-xs text-subtle">{data.metrics.missingLastWeek.slice(0, 3).map((e) => e.fullName).join(", ")}{data.metrics.missingLastWeek.length > 3 ? "…" : ""}</span>
                  </span>
                </li>
              ) : null}
              {data.attendance && data.attendance.pendingReview > 0 ? (
                <li className="flex items-start gap-3 py-3 first:pt-0">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <Link href="/frequencia?conferencia=PENDING" className="link text-sm">{data.attendance.pendingReview} ocorrência(s) aguardando conferência</Link>
                </li>
              ) : null}
              {data.followUps?.map((f) => (
                <li key={f.id} className="flex items-start gap-3 py-3 first:pt-0">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <span className="text-sm">
                    <Link href={`/feedbacks/${f.id}`} className="link">Acompanhamento de feedback — {f.employee.fullName}</Link>
                    <span className="block text-xs text-subtle">Previsto para {formatDate(f.followUpDate)}</span>
                  </span>
                </li>
              ))}
              {data.withoutSchedule?.length ? (
                <li className="flex items-start gap-3 py-3 first:pt-0">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <span className="text-sm">
                    <Link href="/frequencia/jornadas" className="link">{data.withoutSchedule.length} colaborador(es) sem jornada vigente</Link>
                    <span className="block text-xs text-subtle">{data.withoutSchedule.slice(0, 3).map((e) => e.fullName).join(", ")}{data.withoutSchedule.length > 3 ? "…" : ""}</span>
                  </span>
                </li>
              ) : null}
            </ul>
          )}
        </Panel>

        {data.attendance ? (
          <Panel title="Ocorrências por mês" description="Faltas, atestados, atrasos e ausências (exceto desconsideradas).">
            {data.attendance.occurrences === 0 ? (
              <EmptyState
                icon={<FileWarning className="size-5" />}
                title="Sem ocorrências no período"
                action={can(actor, "attendance:write") ? <Link href="/frequencia/ocorrencias/nova" className="btn btn-secondary btn-sm">Registrar ocorrência</Link> : null}
              />
            ) : (
              <>
                <CountBars label="Ocorrências" data={monthRange(fromMonth, toMonth).map((m) => ({ month: monthKey(m), value: data.attendance!.byMonth[monthKey(m)] ?? 0 }))} />
                <ul className="mt-4 flex flex-wrap gap-2">
                  {data.attendance.byType.map((b) => (
                    <li key={b.name}><Badge tone="neutral" icon={false}>{b.name}: {b.count}</Badge></li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        ) : null}

        {data.upcomingMeetings ? (
          <Panel title="Próximas reuniões" actions={<Link href="/reunioes" className="btn btn-ghost btn-sm">Ver todas</Link>}>
            {data.upcomingMeetings.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="Nenhuma reunião agendada"
                action={can(actor, "meetings:write") ? <Link href="/reunioes/nova" className="btn btn-secondary btn-sm">Nova reunião</Link> : null}
              />
            ) : (
              <ul className="-my-2 flex flex-col divide-y divide-line">
                {data.upcomingMeetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/reunioes/${m.id}`} className="group flex items-center gap-4 py-3">
                      <span className="flex w-11 shrink-0 flex-col items-center">
                        <span className="num text-[30px] transition-colors group-hover:text-primary">{String(m.date.getUTCDate()).padStart(2, "0")}</span>
                        <span className="eyebrow mt-1 text-[10px]">{formatMonth(m.date).split("/")[0]}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-medium group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{m.title}</span>
                        <span className="block text-xs text-subtle">{formatTime(m.startMinute)} · {agendaStats(m.agenda).items} item(ns) de pauta</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
