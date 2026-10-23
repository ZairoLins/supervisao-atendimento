import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { assertUuid, orNotFound } from "@/lib/page";
import { addDays, formatDateTime, monthKey } from "@/lib/dates";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getMetric, weekLabel } from "@/modules/metrics/service";
import { correctMetricAction } from "@/modules/metrics/actions";
import { ActionForm, FormMessage, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { DescriptionList, Notice, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Lançamento da semana" };

const dec = (v: unknown) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MetricPage(props: PageProps<"/desempenho/[id]">) {
  const actor = await requirePermission("metrics:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const m = await orNotFound(getMetric(db, actor, id));
  const tz = env().APP_TIMEZONE;
  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("employee", m.employee.code)} · Desempenho`}
        title={`${m.employee.fullName} — semana ${weekLabel(m.weekStart)}`}
        actions={<Link className="btn btn-ghost" href={`/desempenho?colaborador=${m.employee.id}&mes=${monthKey(addDays(m.weekStart, 4))}`}>Ver evolução</Link>}
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Lançamento salvo.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Valores vigentes">
            <DescriptionList
              items={[
                { label: "Chamados atendidos", value: m.ticketsHandled.toLocaleString("pt-BR") },
                { label: "Tempo médio de atendimento", value: `${dec(m.avgHandleMinutes)} min` },
                { label: "Avaliação média", value: dec(m.avgRating) },
                { label: "Função e equipe na semana", value: `${m.jobTitleSnapshot} · ${m.teamSnapshot}` },
                { label: "Lançado em", value: formatDateTime(m.createdAt, tz) },
              ]}
            />
            <hr className="divider my-6" />
            <p className="eyebrow mb-2">Observações</p>
            <p className="whitespace-pre-line text-sm text-muted">{m.notes || "—"}</p>
          </Panel>
          <Panel title="Histórico de correções" description="Valores anteriores a cada correção. O primeiro item da lista mais antiga é o lançamento original.">
            {m.revisions.length === 0 ? (
              <p className="text-sm text-muted">Sem correções — estes são os valores originais.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Corrigido em</th><th className="text-right">Chamados</th><th className="text-right">TMA</th><th className="text-right">Avaliação</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {m.revisions.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, tz)}</td>
                        <td className="text-right tabular-nums">{r.ticketsHandled.toLocaleString("pt-BR")}</td>
                        <td className="text-right tabular-nums">{dec(r.avgHandleMinutes)}</td>
                        <td className="text-right tabular-nums">{dec(r.avgRating)}</td>
                        <td className="text-xs text-muted">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
        {can(actor, "metrics:write") ? (
          <Panel title="Corrigir lançamento" description="Os valores atuais serão guardados no histórico antes da alteração.">
            <ActionForm action={correctMetricAction.bind(null, m.id)} className="flex flex-col gap-5">
              <TextField name="ticketsHandled" label="Chamados atendidos" type="number" required min={0} defaultValue={m.ticketsHandled} />
              <TextField name="avgHandleMinutes" label="Tempo médio (min)" type="number" step="0.01" min={0} required defaultValue={Number(m.avgHandleMinutes)} />
              <TextField name="avgRating" label="Avaliação média (0 a 10)" type="number" step="0.01" min={0} max={10} required defaultValue={Number(m.avgRating)} />
              <TextAreaField name="notes" label="Observações" rows={3} defaultValue={m.notes} maxLength={2000} />
              <TextAreaField name="reason" label="Motivo da correção" required rows={2} maxLength={500} />
              <SubmitButton>Registrar correção</SubmitButton>
              <FormMessage />
            </ActionForm>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
