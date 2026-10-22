import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, ClipboardPlus, LineChart, UserPlus, FileWarning } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { addMonths, formatDate, formatMonth, formatTime, monthKey, monthRange, parseMonthKey, startOfMonth } from "@/lib/dates";
import { TASK_PRIORITY } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { loadDashboard } from "@/modules/dashboard/service";
import { pctChange } from "@/modules/metrics/service";
import { employeeOptions } from "@/modules/employees/service";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui/primitives";
import { CountBars, MetricTrend } from "@/components/charts/metric-trend";

export const metadata: Metadata = { title: "Dashboard" };

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
  const periodLabel = `${formatMonth(fromMonth)} — ${formatMonth(toMonth)}`;
  const attention =
    (data.attendance?.pendingReview ?? 0) +
    (data.tasks?.overdue ?? 0) +
    (data.followUps?.length ?? 0) +
    (data.withoutSchedule?.length ?? 0) +
    (data.metrics?.missingLastMonth.length ?? 0);

  const shortcuts = [
    can(actor, "employees:write") && { href: "/colaboradores/novo", label: "Cadastrar colaborador", icon: UserPlus },
    can(actor, "attendance:write") && { href: "/frequencia/ocorrencias/nova", label: "Registrar ocorrência", icon: FileWarning },
    can(actor, "metrics:write") && { href: "/desempenho/lancar", label: "Lançar métricas", icon: LineChart },
    can(actor, "meetings:write") && { href: "/reunioes/nova", label: "Criar reunião", icon: CalendarPlus },
    can(actor, "tasks:write") && { href: "/tarefas/nova", label: "Adicionar tarefa", icon: ClipboardPlus },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof UserPlus }>;

  return (
    <>
      <PageHeader eyebrow={`Hoje, ${formatDate(t)}`} title={`Olá, ${actor.name.split(" ")[0]}`} description="Visão geral da equipe com dados registrados no sistema." />

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <form method="get" className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="d-de" className="label">De (mês)</label>
            <input id="d-de" type="month" name="de" defaultValue={monthKey(fromMonth)} className="input w-40" />
          </div>
          <div>
            <label htmlFor="d-ate" className="label">Até (mês)</label>
            <input id="d-ate" type="month" name="ate" defaultValue={monthKey(toMonth)} className="input w-40" />
          </div>
          {employees.length ? (
            <div>
              <label htmlFor="d-col" className="label">Colaborador</label>
              <select id="d-col" name="colaborador" defaultValue={employeeId ?? ""} className="input w-56">
                <option value="">Toda a equipe</option>
                {employees.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="submit" className="btn btn-secondary">Aplicar</button>
        </form>
        {shortcuts.length ? (
          <nav aria-label="Atalhos" className="flex flex-wrap gap-2">
            {shortcuts.map((s) => (
              <Link key={s.href} href={s.href} className="btn btn-ghost btn-sm border-cork">
                <s.icon className="size-3.5" aria-hidden /> {s.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <section aria-label="Indicadores" className="mb-[18px] grid grid-cols-2 gap-[18px] lg:grid-cols-3 2xl:grid-cols-6">
        {data.activeEmployees !== null ? (
          <Stat label="Colaboradores ativos" value={data.activeEmployees} hint={`${data.totalEmployees} cadastrados no total`} href="/colaboradores" />
        ) : null}
        {data.attendance ? (
          <Stat
            label="Ocorrências de frequência"
            value={data.attendance.occurrences}
            hint={<>{periodLabel} · <Delta current={data.attendance.occurrences} previous={data.attendance.previous} /></>}
            href="/frequencia"
          />
        ) : null}
        {data.metrics ? (
          <>
            <Stat
              label="Chamados registrados"
              value={data.metrics.current.tickets?.toLocaleString("pt-BR") ?? "—"}
              hint={data.metrics.current.tickets === null ? "Sem métricas no período" : <Delta current={data.metrics.current.tickets} previous={data.metrics.previous.tickets} />}
              href="/desempenho"
            />
            <Stat
              label="Avaliação média"
              value={data.metrics.current.rating?.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) ?? "—"}
              hint={data.metrics.current.rating === null ? "Sem métricas no período" : "Média simples dos lançamentos (0–10)"}
              href="/desempenho"
            />
            <Stat
              label="Tempo médio de atendimento"
              value={data.metrics.current.aht === null ? "—" : `${data.metrics.current.aht.toLocaleString("pt-BR")} min`}
              hint={data.metrics.current.aht === null ? "Sem métricas no período" : "Ponderado pelo volume de chamados"}
              href="/desempenho"
            />
          </>
        ) : null}
        {data.tasks ? (
          <Stat
            label="Tarefas pendentes"
            value={data.tasks.open}
            tone={data.tasks.overdue ? "warn" : undefined}
            hint={data.tasks.overdue ? `${data.tasks.overdue} atrasada(s)` : "Nenhuma atrasada"}
            href="/tarefas?status=OPEN"
          />
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[2fr_1fr]">
        {data.metrics ? (
          <Panel title="Evolução mensal dos indicadores" description={`${periodLabel}${employeeId ? " · colaborador selecionado" : " · equipe"}`}>
            {hasMetrics ? (
              <MetricTrend data={data.metrics.series} primaryLabel={employeeId ? "Colaborador" : "Equipe"} />
            ) : (
              <EmptyState
                title="Nenhuma métrica no período"
                description="Os gráficos usam apenas lançamentos reais. Lance os indicadores mensais para acompanhar a evolução."
                action={can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-primary">Lançar métricas</Link> : null}
              />
            )}
          </Panel>
        ) : null}

        <Panel title="Precisa de atenção" description={attention ? `${attention} item(ns)` : undefined}>
          {attention === 0 ? (
            <p className="text-sm text-muted">Nada pendente no momento.</p>
          ) : (
            <ul className="flex flex-col gap-4 text-sm">
              {data.attendance && data.attendance.pendingReview > 0 ? (
                <li className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <Link href="/frequencia?conferencia=PENDING" className="link">{data.attendance.pendingReview} ocorrência(s) aguardando conferência</Link>
                </li>
              ) : null}
              {data.tasks?.overdueList.map((task) => (
                <li key={task.id} className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                  <span>
                    <Link href={`/tarefas/${task.id}`} className="link">{task.title}</Link>
                    <span className="block text-xs text-subtle">{formatCode("task", task.code)} · venceu em {formatDate(task.dueDate)} · {TASK_PRIORITY[task.priority as keyof typeof TASK_PRIORITY].label}</span>
                  </span>
                </li>
              ))}
              {data.followUps?.map((f) => (
                <li key={f.id} className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <span>
                    <Link href={`/feedbacks/${f.id}`} className="link">Acompanhamento de feedback — {f.employee.fullName}</Link>
                    <span className="block text-xs text-subtle">Previsto para {formatDate(f.followUpDate)}</span>
                  </span>
                </li>
              ))}
              {data.withoutSchedule?.length ? (
                <li className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  <span>
                    <Link href="/frequencia/jornadas" className="link">{data.withoutSchedule.length} colaborador(es) ativo(s) sem jornada vigente</Link>
                    <span className="block text-xs text-subtle">{data.withoutSchedule.slice(0, 3).map((e) => e.fullName).join(", ")}{data.withoutSchedule.length > 3 ? "…" : ""}</span>
                  </span>
                </li>
              ) : null}
              {data.metrics?.missingLastMonth.length ? (
                <li className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                  <span>
                    <Link href={`/desempenho/lancar?mes=${monthKey(addMonths(startOfMonth(t), -1))}`} className="link">
                      {data.metrics.missingLastMonth.length} colaborador(es) sem métricas de {formatMonth(addMonths(startOfMonth(t), -1))}
                    </Link>
                  </span>
                </li>
              ) : null}
            </ul>
          )}
        </Panel>

        {data.attendance ? (
          <Panel title="Ocorrências por mês" description="Ocorrências que descontam horas, exceto desconsideradas.">
            {data.attendance.occurrences === 0 ? (
              <EmptyState
                title="Sem ocorrências no período"
                description="Nenhuma falta, atestado, atraso ou ausência registrada."
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
          <Panel title="Próximas reuniões" actions={<Link href="/reunioes" className="btn btn-ghost btn-sm">Todas</Link>}>
            {data.upcomingMeetings.length === 0 ? (
              <EmptyState
                title="Nenhuma reunião agendada"
                action={can(actor, "meetings:write") ? <Link href="/reunioes/nova" className="btn btn-secondary btn-sm">Criar reunião</Link> : null}
              />
            ) : (
              <ul className="flex flex-col">
                {data.upcomingMeetings.map((m) => (
                  <li key={m.id} className="border-b border-dashed border-cork py-3 first:pt-0 last:border-0">
                    <Link href={`/reunioes/${m.id}`} className="link">{m.title}</Link>
                    <p className="mt-1 text-xs text-subtle">
                      {formatDate(m.date)} · {formatTime(m.startMinute)} · {m._count.agendaItems} item(ns) de pauta
                    </p>
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
