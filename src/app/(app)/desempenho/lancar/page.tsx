import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { addDays, dayNumber, formatDate, toDateKey } from "@/lib/dates";
import { readParams, safeDateParam } from "@/lib/validation";
import { weekLabel, weekStartOf, weeklyBatchData } from "@/modules/metrics/service";
import { saveWeeklyBatchAction } from "@/modules/metrics/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton } from "@/components/ui/form";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { BatchInput } from "./batch-input";

export const metadata: Metadata = { title: "Lançar métricas da semana" };

export default async function WeeklyMetricsPage(props: PageProps<"/desempenho/lancar">) {
  const actor = await requirePermission("metrics:write");
  const params = readParams(await props.searchParams);
  const t = today();
  const currentWeek = weekStartOf(t);
  let weekStart = weekStartOf(safeDateParam(params.semana) ?? t);
  if (dayNumber(weekStart) > dayNumber(currentWeek)) weekStart = currentWeek;
  const rows = await weeklyBatchData(db, actor, weekStart);
  const key = toDateKey(weekStart);
  const filled = rows.filter((r) => r.metric).length;
  const isCurrent = dayNumber(weekStart) === dayNumber(currentWeek);
  const nav = (ws: Date) => `/desempenho/lancar?semana=${toDateKey(ws)}`;

  return (
    <>
      <PageHeader
        eyebrow="Desempenho"
        title="Lançar métricas da semana"
        description="Preencha os indicadores da semana de cada colaborador (por exemplo, toda sexta-feira), incluindo quantas avaliações a nota representa. Linhas em branco são ignoradas; ao alterar um lançamento existente, o valor anterior fica guardado."
        actions={
          <>
            {can(actor, "reports:export") && filled > 0 ? (
              <a href={`/api/relatorios?tipo=semanal&formato=pdf&semana=${key}`} target="_blank" rel="noopener" className="btn btn-secondary">
                <FileDown className="size-4" aria-hidden /> Relatório da semana (PDF)
              </a>
            ) : null}
            <Link href="/desempenho" className="btn btn-secondary">Ver desempenho</Link>
          </>
        }
      />

      <Panel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={nav(addDays(weekStart, -7))} className="btn btn-secondary btn-sm px-2" aria-label="Semana anterior">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <div className="rounded-lg border border-line bg-surface-2 px-4 py-1.5 text-center">
              <p className="text-sm font-semibold">Semana {weekLabel(weekStart)}</p>
              <p className="text-xs text-subtle">segunda a domingo</p>
            </div>
            {!isCurrent ? (
              <Link href={nav(addDays(weekStart, 7))} className="btn btn-secondary btn-sm px-2" aria-label="Próxima semana">
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : null}
            <form method="get" className="flex items-center gap-2">
              <label htmlFor="l-sem" className="sr-only">Ir para a semana de</label>
              <input id="l-sem" type="date" name="semana" defaultValue={key} max={toDateKey(t)} className="input w-44" title="Escolha qualquer dia da semana" />
              <button type="submit" className="btn btn-ghost btn-sm">Ir</button>
            </form>
            {!isCurrent ? <Link href="/desempenho/lancar" className="btn btn-ghost btn-sm">Semana atual</Link> : null}
          </div>
          <p className="text-sm text-muted">{filled} de {rows.length} lançado(s)</p>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nenhum colaborador ativo nesta semana" description="Cadastre colaboradores para lançar métricas." action={<Link href="/colaboradores/novo" className="btn btn-primary">Cadastrar colaborador</Link>} />
        ) : (
          <ActionForm action={saveWeeklyBatchAction} className="flex flex-col gap-5">
            <Hidden name="week" value={key} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th className="w-32">Chamados</th>
                    <th className="w-36">Tempo médio (min)</th>
                    <th className="w-28">Nota (0–10)</th>
                    <th className="w-28" title="Quantidade de avaliações recebidas na semana">Avaliações</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ employee: e, metric: m }) => (
                    <tr key={e.id}>
                      <td className="min-w-48">
                        <p className="font-medium">{e.fullName}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                          {e.team}
                          {m ? <Badge tone="ok" icon={false}>Lançado</Badge> : null}
                        </p>
                      </td>
                      <td><BatchInput name={`t_${e.id}`} label={`Chamados de ${e.fullName}`} defaultValue={m?.ticketsHandled} step="1" min={0} /></td>
                      <td><BatchInput name={`a_${e.id}`} label={`Tempo médio de ${e.fullName}`} defaultValue={m ? Number(m.avgHandleMinutes) : null} step="0.01" min={0} /></td>
                      <td><BatchInput name={`r_${e.id}`} label={`Nota média de ${e.fullName}`} defaultValue={m && m.ratingCount !== 0 ? Number(m.avgRating) : null} step="0.01" min={0} max={10} /></td>
                      <td><BatchInput name={`q_${e.id}`} label={`Quantidade de avaliações de ${e.fullName}`} defaultValue={m?.ratingCount} step="1" min={0} placeholder={m && m.ratingCount === null ? "?" : undefined} /></td>
                      <td className="min-w-48"><BatchInput name={`n_${e.id}`} label={`Observação de ${e.fullName}`} type="text" defaultValue={m?.notes} placeholder="Opcional" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Salvar lançamentos da semana</SubmitButton>
              <FormMessage />
            </div>
            <p className="text-xs text-subtle">
              A semana entra no mês da sua sexta-feira ({formatDate(addDays(weekStart, 4))}). A nota média do time é ponderada pela quantidade de avaliações: 10 com 2 avaliações pesa menos que 9,2 com 13. Sem avaliações na semana, informe 0 e deixe a nota em branco.
            </p>
          </ActionForm>
        )}
      </Panel>
    </>
  );
}
