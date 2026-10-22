import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { formatDate, toDateKey } from "@/lib/dates";
import { FEEDBACK_STATUS, FEEDBACK_TYPE } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams, safeDateParam } from "@/lib/validation";
import { listFeedbacks } from "@/modules/feedbacks/service";
import { employeeOptions } from "@/modules/employees/service";
import { Badge, EmptyState, LabelBadge, PageHeader, Pagination, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Feedbacks" };

export default async function FeedbacksPage(props: PageProps<"/feedbacks">) {
  const actor = await requirePermission("feedbacks:read");
  const params = readParams(await props.searchParams);
  const t = today();
  const type = pickEnum(params.tipo, ["RECOGNITION", "DEVELOPMENT", "CORRECTIVE", "ALIGNMENT", "ONE_ON_ONE"] as const);
  const status = pickEnum(params.status, ["OPEN", "FOLLOW_UP", "CLOSED"] as const);
  const employeeId = params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador) ? params.colaborador : undefined;
  const from = safeDateParam(params.de);
  const to = safeDateParam(params.ate);
  const followUpDue = params.acompanhamento === "vencido" ? t : undefined;
  const [result, employees] = await Promise.all([
    listFeedbacks(db, actor, { employeeId, type, status, from, to, q: params.q, followUpDue, page: pageParam(params) }),
    employeeOptions(db, actor, { includeInactive: true }),
  ]);
  const filtered = Boolean(params.q || type || status || employeeId || from || to || followUpDue);

  return (
    <>
      <PageHeader
        eyebrow="Desenvolvimento"
        title="Feedbacks"
        description="Conversas individuais com contexto, pontos positivos, pontos a desenvolver e ações acordadas. Distintos de anotações gerais e de frequência."
        actions={can(actor, "feedbacks:write") ? <Link href="/feedbacks/novo" className="btn btn-primary"><Plus className="size-3.5" aria-hidden /> Novo feedback</Link> : null}
      />
      <Panel>
        <form method="get" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.4fr_1.4fr_1fr_1fr_0.9fr_0.9fr_auto] xl:items-end">
          <div><label className="label" htmlFor="f-q">Buscar</label><input id="f-q" name="q" defaultValue={params.q} placeholder="Nome, contexto ou FDB-0001" className="input" /></div>
          <div>
            <label className="label" htmlFor="f-col">Colaborador</label>
            <select id="f-col" name="colaborador" defaultValue={employeeId ?? ""} className="input"><option value="">Todos</option>{employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="f-tipo">Tipo</label>
            <select id="f-tipo" name="tipo" defaultValue={type ?? ""} className="input"><option value="">Todos</option>{Object.entries(FEEDBACK_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="f-st">Situação</label>
            <select id="f-st" name="status" defaultValue={status ?? ""} className="input"><option value="">Todas</option>{Object.entries(FEEDBACK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="f-de">De</label><input id="f-de" type="date" name="de" defaultValue={from ? toDateKey(from) : ""} className="input" /></div>
          <div><label className="label" htmlFor="f-ate">Até</label><input id="f-ate" type="date" name="ate" defaultValue={to ? toDateKey(to) : ""} className="input" /></div>
          <div className="flex gap-2"><button type="submit" className="btn btn-secondary">Filtrar</button>{filtered ? <Link href="/feedbacks" className="btn btn-ghost">Limpar</Link> : null}</div>
        </form>
        <p className="mb-4 text-xs"><Link href="/feedbacks?acompanhamento=vencido" className="link">Ver acompanhamentos vencidos</Link></p>
        {result.total === 0 ? (
          filtered ? <EmptyState title="Nenhum feedback encontrado" description="Ajuste os filtros." /> : (
            <EmptyState icon={<MessageSquareText className="size-6" />} title="Nenhum feedback registrado" description="Registre o primeiro feedback individual." action={can(actor, "feedbacks:write") ? <Link href="/feedbacks/novo" className="btn btn-primary">Novo feedback</Link> : null} />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>ID</th><th>Data</th><th>Colaborador</th><th>Tipo</th><th>Situação</th><th>Acompanhamento</th></tr></thead>
                <tbody>
                  {result.items.map((f) => (
                    <tr key={f.id}>
                      <td className="text-xs text-subtle"><Link className="link" href={`/feedbacks/${f.id}`}>{formatCode("feedback", f.code)}</Link></td>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(f.date)}</td>
                      <td><Link className="link" href={`/colaboradores/${f.employee.id}?aba=feedbacks`}>{f.employee.fullName}</Link></td>
                      <td>{FEEDBACK_TYPE[f.type].label}</td>
                      <td><LabelBadge map={FEEDBACK_STATUS} value={f.status} /></td>
                      <td className="whitespace-nowrap tabular-nums">
                        {f.followUpDate ? formatDate(f.followUpDate) : "—"}
                        {f.followUpDate && f.status !== "CLOSED" && f.followUpDate.getTime() <= t.getTime() ? <span className="ml-2"><Badge tone="warn">Vencido</Badge></span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination base="/feedbacks" params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </Panel>
    </>
  );
}
