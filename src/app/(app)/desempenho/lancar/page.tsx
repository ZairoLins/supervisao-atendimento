import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { addDays, dayNumber, formatDate, formatWeekday, toDateKey } from "@/lib/dates";
import { readParams, safeDateParam } from "@/lib/validation";
import { dailyBatchData } from "@/modules/metrics/service";
import { saveDailyBatchAction } from "@/modules/metrics/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton } from "@/components/ui/form";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { BatchInput } from "./batch-input";

export const metadata: Metadata = { title: "Lançar métricas do dia" };

export default async function DailyMetricsPage(props: PageProps<"/desempenho/lancar">) {
  const actor = await requirePermission("metrics:write");
  const params = readParams(await props.searchParams);
  const t = today();
  let date = safeDateParam(params.data) ?? t;
  if (dayNumber(date) > dayNumber(t)) date = t;
  const rows = await dailyBatchData(db, actor, date);
  const key = toDateKey(date);
  const filled = rows.filter((r) => r.metric).length;
  const isToday = dayNumber(date) === dayNumber(t);

  return (
    <>
      <PageHeader
        eyebrow="Desempenho"
        title="Lançar métricas do dia"
        description="Preencha os indicadores de cada colaborador. Linhas em branco são ignoradas; ao alterar um lançamento existente, o valor anterior fica guardado no histórico."
        actions={<Link href="/desempenho" className="btn btn-secondary">Ver desempenho</Link>}
      />

      <Panel>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={`/desempenho/lancar?data=${toDateKey(addDays(date, -1))}`} className="btn btn-secondary btn-sm px-2" aria-label="Dia anterior">
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <form method="get" className="flex items-center gap-2">
              <label htmlFor="l-data" className="sr-only">Data</label>
              <input id="l-data" type="date" name="data" defaultValue={key} max={toDateKey(t)} className="input w-44" />
              <button type="submit" className="btn btn-secondary btn-sm">Ir</button>
            </form>
            {!isToday ? (
              <Link href={`/desempenho/lancar?data=${toDateKey(addDays(date, 1))}`} className="btn btn-secondary btn-sm px-2" aria-label="Próximo dia">
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : null}
            {!isToday ? <Link href="/desempenho/lancar" className="btn btn-ghost btn-sm">Hoje</Link> : null}
          </div>
          <p className="text-sm text-muted">
            <span className="font-medium text-ink">{formatWeekday(date)}, {formatDate(date)}</span> · {filled} de {rows.length} lançado(s)
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="Nenhum colaborador ativo nesta data" description="Cadastre colaboradores para lançar métricas." action={<Link href="/colaboradores/novo" className="btn btn-primary">Cadastrar colaborador</Link>} />
        ) : (
          <ActionForm action={saveDailyBatchAction} className="flex flex-col gap-5">
            <Hidden name="date" value={key} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th className="w-32">Chamados</th>
                    <th className="w-36">Tempo médio (min)</th>
                    <th className="w-32">Avaliação (0–10)</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ employee: e, metric: m, scheduled }) => (
                    <tr key={e.id}>
                      <td className="min-w-48">
                        <p className="font-medium">{e.fullName}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle">
                          {e.team}
                          {scheduled === false ? <Badge tone="neutral" icon={false}>Folga</Badge> : null}
                          {m ? <Badge tone="ok" icon={false}>Lançado</Badge> : null}
                        </p>
                      </td>
                      <td><BatchInput name={`t_${e.id}`} label={`Chamados de ${e.fullName}`} defaultValue={m?.ticketsHandled} step="1" min={0} /></td>
                      <td><BatchInput name={`a_${e.id}`} label={`Tempo médio de ${e.fullName}`} defaultValue={m ? Number(m.avgHandleMinutes) : null} step="0.01" min={0} /></td>
                      <td><BatchInput name={`r_${e.id}`} label={`Avaliação de ${e.fullName}`} defaultValue={m ? Number(m.avgRating) : null} step="0.01" min={0} max={10} /></td>
                      <td className="min-w-48"><BatchInput name={`n_${e.id}`} label={`Observação de ${e.fullName}`} type="text" defaultValue={m?.notes} placeholder="Opcional" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Salvar lançamentos do dia</SubmitButton>
              <FormMessage />
            </div>
          </ActionForm>
        )}
      </Panel>
    </>
  );
}
