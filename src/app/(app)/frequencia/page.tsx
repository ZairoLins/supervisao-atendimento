import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Paperclip, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { formatDate, formatTimeRange, toDateKey } from "@/lib/dates";
import { REVIEW_STATUS } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams, safeDateParam } from "@/lib/validation";
import { listOccurrences, listOccurrenceTypes } from "@/modules/attendance/occurrences";
import { employeeOptions } from "@/modules/employees/service";
import { EmptyState, LabelBadge, Notice, PageHeader, Pagination, Panel } from "@/components/ui/primitives";
import { AttendanceNav } from "./nav";

export const metadata: Metadata = { title: "Frequência e escalas" };

export default async function AttendancePage(props: PageProps<"/frequencia">) {
  const actor = await requirePermission("attendance:read");
  const params = readParams(await props.searchParams);
  const reviewStatus = pickEnum(params.conferencia, ["PENDING", "CONFIRMED", "DISREGARDED"] as const);
  const from = safeDateParam(params.de);
  const to = safeDateParam(params.ate);
  const employeeId = params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador) ? params.colaborador : undefined;
  const typeId = params.tipo && /^[0-9a-f-]{36}$/.test(params.tipo) ? params.tipo : undefined;
  const [result, types, employees] = await Promise.all([
    listOccurrences(db, actor, { employeeId, typeId, reviewStatus, from, to, q: params.q, page: pageParam(params) }),
    listOccurrenceTypes(db, actor, { includeInactive: true }),
    employeeOptions(db, actor, { includeInactive: true }),
  ]);
  const filtered = Boolean(params.q || reviewStatus || from || to || employeeId || typeId);

  return (
    <>
      <PageHeader
        eyebrow="Controle gerencial"
        title="Frequência e escalas"
        description="Faltas, atestados, atrasos, ausências, trocas e ajustes. Ferramenta de acompanhamento: não calcula descontos salariais nem avalia validade jurídica de atestados."
        actions={
          can(actor, "attendance:write") ? (
            <Link href="/frequencia/ocorrencias/nova" className="btn btn-primary">
              <Plus className="size-3.5" aria-hidden /> Registrar ocorrência
            </Link>
          ) : null
        }
      />
      <AttendanceNav active="ocorrencias" />
      {params.excluida ? <div className="mb-6"><Notice tone="ok">Ocorrência excluída (mantida na auditoria).</Notice></div> : null}
      <Panel>
        <form method="get" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.4fr_1.4fr_1fr_1fr_0.9fr_0.9fr_auto] xl:items-end">
          <div>
            <label className="label" htmlFor="o-q">Buscar</label>
            <input id="o-q" name="q" defaultValue={params.q} placeholder="Nome, tipo ou OCO-0001" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="o-col">Colaborador</label>
            <select id="o-col" name="colaborador" defaultValue={employeeId ?? ""} className="input">
              <option value="">Todos</option>
              {employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="o-tipo">Tipo</label>
            <select id="o-tipo" name="tipo" defaultValue={typeId ?? ""} className="input">
              <option value="">Todos</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="o-conf">Conferência</label>
            <select id="o-conf" name="conferencia" defaultValue={reviewStatus ?? ""} className="input">
              <option value="">Todas</option>
              {Object.entries(REVIEW_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="o-de">De</label>
            <input id="o-de" type="date" name="de" defaultValue={from ? toDateKey(from) : ""} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="o-ate">Até</label>
            <input id="o-ate" type="date" name="ate" defaultValue={to ? toDateKey(to) : ""} className="input" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-secondary">Filtrar</button>
            {filtered ? <Link href="/frequencia" className="btn btn-ghost">Limpar</Link> : null}
          </div>
        </form>

        {result.total === 0 ? (
          filtered ? (
            <EmptyState title="Nenhuma ocorrência encontrada" description="Ajuste os filtros para ampliar a busca." />
          ) : (
            <EmptyState
              icon={<CalendarClock className="size-6" />}
              title="Nenhuma ocorrência registrada"
              description="Registre faltas, atestados, atrasos e ausências parciais. Trocas e ajustes são feitos na escala do colaborador."
              action={can(actor, "attendance:write") ? <Link href="/frequencia/ocorrencias/nova" className="btn btn-primary">Registrar a primeira ocorrência</Link> : null}
            />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>ID</th><th>Data</th><th>Colaborador</th><th>Tipo</th><th>Horário</th><th>Conferência</th><th className="sr-only">Anexos</th></tr>
                </thead>
                <tbody>
                  {result.items.map((o) => (
                    <tr key={o.id}>
                      <td className="text-xs text-subtle"><Link href={`/frequencia/ocorrencias/${o.id}`} className="link">{formatCode("occurrence", o.code)}</Link></td>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(o.date)}</td>
                      <td><Link href={`/colaboradores/${o.employee.id}?aba=frequencia`} className="link">{o.employee.fullName}</Link></td>
                      <td>{o.type.name}{o.adjustmentId ? <span className="block text-xs text-subtle">Gerada pela escala</span> : null}</td>
                      <td className="whitespace-nowrap text-muted">{o.startMinute !== null && o.endMinute !== null ? formatTimeRange(o.startMinute, o.endMinute) : "Dia inteiro"}</td>
                      <td><LabelBadge map={REVIEW_STATUS} value={o.reviewStatus} /></td>
                      <td className="text-subtle">
                        {o._count.attachments && can(actor, "attendance:restricted") ? (
                          <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="size-3" aria-hidden />{o._count.attachments}<span className="sr-only">anexo(s)</span></span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination base="/frequencia" params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </Panel>
    </>
  );
}
