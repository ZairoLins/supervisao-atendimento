import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { EMPLOYEE_STATUS } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams } from "@/lib/validation";
import { distinctTeamsAndTitles, listEmployees } from "@/modules/employees/service";
import { EmptyState, LabelBadge, PageHeader, Pagination, Panel, SortHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function EmployeesPage(props: PageProps<"/colaboradores">) {
  const actor = await requirePermission("employees:read");
  const params = readParams(await props.searchParams);
  const status = pickEnum(params.status, ["ACTIVE", "ON_LEAVE", "INACTIVE", "ALL"] as const);
  const sort = pickEnum(params.sort, ["name", "code", "team", "startDate"] as const);
  const dir = pickEnum(params.dir, ["asc", "desc"] as const);
  const [result, { teams, titles }] = await Promise.all([
    listEmployees(db, actor, { q: params.q, status, team: params.team, jobTitle: params.jobTitle, sort, dir, page: pageParam(params) }),
    distinctTeamsAndTitles(db),
  ]);
  const filtered = Boolean(params.q || params.status || params.team || params.jobTitle);

  return (
    <>
      <PageHeader
        eyebrow="Equipe"
        title="Colaboradores"
        description="Cadastro, situação e histórico profissional de cada integrante da equipe."
        actions={
          can(actor, "employees:write") ? (
            <Link href="/colaboradores/novo" className="btn btn-primary">
              <Plus className="size-3.5" aria-hidden /> Novo colaborador
            </Link>
          ) : null
        }
      />
      <Panel>
        <form method="get" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <label className="label" htmlFor="f-q">Buscar</label>
            <input id="f-q" name="q" defaultValue={params.q} placeholder="Nome, função, equipe ou COL-0001" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="f-status">Situação</label>
            <select id="f-status" name="status" defaultValue={params.status ?? ""} className="input">
              <option value="">Ativos e afastados</option>
              <option value="ACTIVE">Ativos</option>
              <option value="ON_LEAVE">Afastados</option>
              <option value="INACTIVE">Inativos</option>
              <option value="ALL">Todos</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-team">Equipe</label>
            <select id="f-team" name="team" defaultValue={params.team ?? ""} className="input">
              <option value="">Todas</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-title">Função</label>
            <select id="f-title" name="jobTitle" defaultValue={params.jobTitle ?? ""} className="input">
              <option value="">Todas</option>
              {titles.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-secondary">Filtrar</button>
            {filtered ? <Link href="/colaboradores" className="btn btn-ghost">Limpar</Link> : null}
          </div>
        </form>

        {result.total === 0 ? (
          filtered ? (
            <EmptyState title="Nenhum colaborador encontrado" description="Ajuste os filtros ou limpe a busca para ver todos os cadastros." />
          ) : (
            <EmptyState
              icon={<Users className="size-6" />}
              title="Nenhum colaborador cadastrado"
              description="Cadastre a equipe para começar a registrar frequência, métricas, feedbacks e tarefas."
              action={can(actor, "employees:write") ? <Link href="/colaboradores/novo" className="btn btn-primary">Cadastrar o primeiro colaborador</Link> : null}
            />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader base="/colaboradores" params={params} field="code">ID</SortHeader>
                    <SortHeader base="/colaboradores" params={params} field="name">Nome</SortHeader>
                    <th>Função</th>
                    <SortHeader base="/colaboradores" params={params} field="team">Equipe</SortHeader>
                    <SortHeader base="/colaboradores" params={params} field="startDate">Entrada</SortHeader>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-xs text-subtle tabular-nums">{formatCode("employee", e.code)}</td>
                      <td>
                        <Link href={`/colaboradores/${e.id}`} className="link">{e.fullName}</Link>
                      </td>
                      <td className="text-muted">{e.jobTitle}</td>
                      <td className="text-muted">{e.team}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted">{formatDate(e.startDate)}</td>
                      <td><LabelBadge map={EMPLOYEE_STATUS} value={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination base="/colaboradores" params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </Panel>
    </>
  );
}
