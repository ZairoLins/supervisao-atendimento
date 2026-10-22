import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { addMonths, formatMonth, monthKey, parseMonthKey, startOfMonth } from "@/lib/dates";
import { readParams } from "@/lib/validation";
import { employeeOptions } from "@/modules/employees/service";
import { employeesWithoutMetric } from "@/modules/metrics/service";
import { createMetricAction } from "@/modules/metrics/actions";
import { ActionForm, CheckboxField, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Lançar métricas" };

export default async function NewMetricPage(props: PageProps<"/desempenho/lancar">) {
  const actor = await requirePermission("metrics:write");
  const params = readParams(await props.searchParams);
  const t = today();
  let month = addMonths(startOfMonth(t), -1);
  try {
    if (params.mes) month = parseMonthKey(params.mes);
  } catch {
    /* mantém o mês anterior */
  }
  const [employees, missing] = await Promise.all([employeeOptions(db, actor), employeesWithoutMetric(db, actor, month)]);

  return (
    <>
      <PageHeader eyebrow="Desempenho" title="Lançar métricas do mês" description="Um lançamento por colaborador e mês. Para alterar um mês já lançado, use a correção — o valor original fica preservado." />
      {employees.length === 0 ? (
        <EmptyState title="Nenhum colaborador ativo" action={<Link href="/colaboradores/novo" className="btn btn-primary">Cadastrar colaborador</Link>} />
      ) : (
        <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[2fr_1fr]">
          <Panel>
            <ActionForm action={createMetricAction} resetOnSuccess className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <SelectField name="employeeId" label="Colaborador" required options={employees} defaultValue={params.colaborador} placeholder="Selecione…" />
              <TextField name="month" label="Mês de referência" type="month" required defaultValue={monthKey(month)} max={monthKey(t)} />
              <TextField name="ticketsHandled" label="Chamados atendidos" type="number" required min={0} step={1} inputMode="numeric" />
              <TextField name="avgHandleMinutes" label="Tempo médio de atendimento (min)" type="number" required min={0} step="0.01" inputMode="decimal" />
              <TextField name="avgRating" label="Avaliação média (0 a 10)" type="number" required min={0} max={10} step="0.01" inputMode="decimal" />
              <div />
              <TextAreaField name="notes" label="Observações sobre o período" className="md:col-span-2" rows={3} maxLength={2000} hint="Contexto que ajude a interpretar os números (ex.: férias, mudança de fila, sistema fora do ar)." />
              <div className="md:col-span-2"><CheckboxField name="next" value="1" label="Continuar lançando após salvar" defaultChecked /></div>
              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <SubmitButton>Salvar lançamento</SubmitButton>
                <Link href="/desempenho" className="btn btn-ghost">Cancelar</Link>
                <FormMessage />
              </div>
            </ActionForm>
          </Panel>
          <Panel title={`Pendentes de ${formatMonth(month)}`} description="Colaboradores ativos sem lançamento neste mês.">
            {missing.length === 0 ? (
              <p className="text-sm text-muted">Todos os colaboradores ativos já têm lançamento.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {missing.map((m) => (
                  <li key={m.id}><Link className="link" href={`/desempenho/lancar?colaborador=${m.id}&mes=${monthKey(month)}`}>{m.fullName}</Link></li>
                ))}
              </ul>
            )}
            <form method="get" className="mt-6 flex items-end gap-3">
              <div><label className="label" htmlFor="l-mes">Outro mês</label><input id="l-mes" type="month" name="mes" defaultValue={monthKey(month)} className="input" /></div>
              <button type="submit" className="btn btn-ghost btn-sm">Ver</button>
            </form>
          </Panel>
        </div>
      )}
    </>
  );
}
