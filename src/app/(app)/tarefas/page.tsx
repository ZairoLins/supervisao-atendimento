import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { formatDate } from "@/lib/dates";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams } from "@/lib/validation";
import { assigneeOptions, isOverdue, listTasks } from "@/modules/tasks/service";
import { Badge, EmptyState, LabelBadge, PageHeader, Pagination, Panel, SortHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Tarefas e pendências" };

export default async function TasksPage(props: PageProps<"/tarefas">) {
  const actor = await requirePermission("tasks:read");
  const params = readParams(await props.searchParams);
  const t = today();
  const status = pickEnum(params.status, ["OPEN", "PENDING", "IN_PROGRESS", "DONE", "CANCELED"] as const);
  const priority = pickEnum(params.prioridade, ["LOW", "MEDIUM", "HIGH", "URGENT"] as const);
  const origin = pickEnum(params.origem, ["meeting", "employee", "feedback", "manual"] as const);
  const due = pickEnum(params.prazo, ["overdue", "week", "none"] as const);
  const assignee = params.responsavel && /^(user|employee):[0-9a-f-]{36}$/.test(params.responsavel) ? params.responsavel : undefined;
  const [result, assignees] = await Promise.all([
    listTasks(db, actor, { q: params.q, status, priority, origin, due, assignee, page: pageParam(params), sort: params.sort, dir: pickEnum(params.dir, ["asc", "desc"] as const) }, t),
    assigneeOptions(db, actor),
  ]);
  const filtered = Boolean(params.q || status || priority || origin || due || assignee);

  return (
    <>
      <PageHeader
        eyebrow="Acompanhamento"
        title="Tarefas e pendências"
        description="Ações de reuniões, pendências da equipe e lembretes da supervisão, com histórico de alterações."
        actions={can(actor, "tasks:write") ? <Link href="/tarefas/nova" className="btn btn-primary"><Plus className="size-3.5" aria-hidden /> Nova tarefa</Link> : null}
      />
      <Panel>
        <form method="get" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1.2fr_auto] xl:items-end">
          <div><label className="label" htmlFor="t-q">Buscar</label><input id="t-q" name="q" defaultValue={params.q} placeholder="Título ou TAR-0001" className="input" /></div>
          <div>
            <label className="label" htmlFor="t-st">Status</label>
            <select id="t-st" name="status" defaultValue={status ?? ""} className="input">
              <option value="">Todos</option>
              <option value="OPEN">Em aberto</option>
              {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-pz">Prazo</label>
            <select id="t-pz" name="prazo" defaultValue={due ?? ""} className="input">
              <option value="">Todos</option><option value="overdue">Atrasadas</option><option value="week">Próximos 7 dias</option><option value="none">Sem prazo</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-pr">Prioridade</label>
            <select id="t-pr" name="prioridade" defaultValue={priority ?? ""} className="input"><option value="">Todas</option>{Object.entries(TASK_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="t-or">Origem</label>
            <select id="t-or" name="origem" defaultValue={origin ?? ""} className="input">
              <option value="">Todas</option><option value="meeting">Reunião</option><option value="employee">Colaborador</option>
              {can(actor, "feedbacks:read") ? <option value="feedback">Feedback</option> : null}
              <option value="manual">Avulsa</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-resp">Responsável</label>
            <select id="t-resp" name="responsavel" defaultValue={assignee ?? ""} className="input"><option value="">Todos</option>{assignees.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
          </div>
          <div className="flex gap-2"><button type="submit" className="btn btn-secondary">Filtrar</button>{filtered ? <Link href="/tarefas" className="btn btn-ghost">Limpar</Link> : null}</div>
        </form>
        {result.total === 0 ? (
          filtered ? <EmptyState title="Nenhuma tarefa encontrada" description="Ajuste os filtros." /> : (
            <EmptyState icon={<ClipboardList className="size-6" />} title="Nenhuma tarefa cadastrada" description="Crie tarefas avulsas ou defina ações nas reuniões." action={can(actor, "tasks:write") ? <Link href="/tarefas/nova" className="btn btn-primary">Criar tarefa</Link> : null} />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <SortHeader base="/tarefas" params={params} field="title">Tarefa</SortHeader>
                    <SortHeader base="/tarefas" params={params} field="priority">Prioridade</SortHeader>
                    <th>Status</th>
                    <SortHeader base="/tarefas" params={params} field="due">Prazo</SortHeader>
                    <th>Responsável</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((task) => (
                    <tr key={task.id}>
                      <td className="text-xs text-subtle">{formatCode("task", task.code)}</td>
                      <td><Link className="link" href={`/tarefas/${task.id}`}>{task.title}</Link></td>
                      <td><LabelBadge map={TASK_PRIORITY} value={task.priority} /></td>
                      <td><LabelBadge map={TASK_STATUS} value={task.status} /></td>
                      <td className="whitespace-nowrap tabular-nums">
                        {task.dueDate ? formatDate(task.dueDate) : "—"}
                        {isOverdue(task, t) ? <span className="ml-2"><Badge tone="danger">Atrasada</Badge></span> : null}
                      </td>
                      <td className="text-muted">{task.assigneeEmployee?.fullName ?? task.assigneeUser?.name ?? "—"}</td>
                      <td className="text-xs">
                        {task.meeting ? <Link className="link" href={`/reunioes/${task.meeting.id}`}>Reunião: {task.meeting.title}</Link>
                          : task.employee ? <Link className="link" href={`/colaboradores/${task.employee.id}?aba=tarefas`}>{task.employee.fullName}</Link>
                          : task.feedbackId ? <Link className="link" href={`/feedbacks/${task.feedbackId}`}>Feedback</Link>
                          : <span className="text-subtle">Avulsa</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination base="/tarefas" params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </Panel>
    </>
  );
}
