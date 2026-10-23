import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MessageSquareText, NotebookPen, Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can, type Actor } from "@/lib/permissions";
import { assertUuid, orNotFound, today } from "@/lib/page";
import { addDays, formatDate, formatDateTime, formatDuration, formatTimeRange, startOfMonth, toDateKey } from "@/lib/dates";
import { EMPLOYEE_STATUS, FEEDBACK_STATUS, FEEDBACK_TYPE, NOTE_CATEGORY, REVIEW_STATUS, options } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getEmployee } from "@/modules/employees/service";
import { inactivateEmployeeAction, reactivateEmployeeAction, createNoteAction, deleteNoteAction } from "@/modules/employees/actions";
import { employeeAttendanceSummary, listOccurrences } from "@/modules/attendance/occurrences";
import { loadRules } from "@/modules/attendance/schedules";
import { findAssignment } from "@/modules/attendance/rules";
import { listMetrics, metricSeries } from "@/modules/metrics/service";
import { listFeedbacks, listNotes } from "@/modules/feedbacks/service";
import { ActionForm, FormMessage, Hidden, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { DescriptionList, EmptyState, LabelBadge, Notice, PageHeader, Panel, Stat, Tabs } from "@/components/ui/primitives";
import { MetricTrend } from "@/components/charts/metric-trend";

export const metadata: Metadata = { title: "Perfil do colaborador" };

const TABS = ["resumo", "desempenho", "frequencia", "feedbacks", "anotacoes"] as const;
type Tab = (typeof TABS)[number];

export default async function EmployeeProfilePage(props: PageProps<"/colaboradores/[id]">) {
  const actor = await requirePermission("employees:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const employee = await orNotFound(getEmployee(db, actor, id));
  const tabs = [
    { key: "resumo", label: "Resumo", show: true },
    { key: "desempenho", label: "Desempenho", show: can(actor, "metrics:read") },
    { key: "frequencia", label: "Frequência", show: can(actor, "attendance:read") },
    { key: "feedbacks", label: "Feedbacks", show: can(actor, "feedbacks:read") },
    { key: "anotacoes", label: "Anotações", show: can(actor, "notes:read") },
  ].filter((t) => t.show);
  const requested = (TABS as readonly string[]).includes(params.aba ?? "") ? (params.aba as Tab) : "resumo";
  const tab: Tab = tabs.some((t) => t.key === requested) ? requested : "resumo";
  const inactive = employee.status === "INACTIVE";

  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("employee", employee.code)} · ${employee.team}`}
        title={employee.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LabelBadge map={EMPLOYEE_STATUS} value={employee.status} />
            <span>{employee.jobTitle}</span>
            <span className="text-subtle">· desde {formatDate(employee.startDate)}</span>
          </span>
        }
        actions={
          can(actor, "employees:write") && !inactive ? (
            <Link href={`/colaboradores/${id}/editar`} className="btn btn-secondary">
              <Pencil className="size-3.5" aria-hidden /> Editar cadastro
            </Link>
          ) : null
        }
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Cadastro salvo com sucesso.</Notice></div> : null}
      {inactive ? (
        <div className="mb-6">
          <Notice tone="warn">
            Colaborador inativo desde {employee.inactivatedAt ? formatDateTime(employee.inactivatedAt) : "—"}. Motivo: {employee.inactivationReason}. Todo o histórico permanece disponível.
          </Notice>
        </div>
      ) : null}
      <Tabs active={tab} items={tabs.map((t) => ({ key: t.key, label: t.label, href: `/colaboradores/${id}?aba=${t.key}` }))} />
      {tab === "resumo" ? <Summary actor={actor} employee={employee} /> : null}
      {tab === "desempenho" ? <Performance actor={actor} employeeId={id} /> : null}
      {tab === "frequencia" ? <Attendance actor={actor} employeeId={id} /> : null}
      {tab === "feedbacks" ? <Feedbacks actor={actor} employeeId={id} /> : null}
      {tab === "anotacoes" ? <Notes actor={actor} employeeId={id} inactive={inactive} /> : null}
    </>
  );
}

type EmployeeRow = Awaited<ReturnType<typeof getEmployee>>;

async function Summary({ actor, employee }: { actor: Actor; employee: EmployeeRow }) {
  const t = today();
  const rules = can(actor, "attendance:read") ? await loadRules(db, employee.id) : null;
  const current = rules ? findAssignment(rules.assignments, t) : null;
  const inactive = employee.status === "INACTIVE";
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
      <Panel title="Dados cadastrais">
        <DescriptionList
          items={[
            { label: "Identificador", value: formatCode("employee", employee.code) },
            { label: "Função", value: employee.jobTitle },
            { label: "Equipe ou setor", value: employee.team },
            { label: "Data de entrada", value: formatDate(employee.startDate) },
            { label: "Jornada (descrição)", value: employee.workloadLabel ?? "—" },
            {
              label: "Jornada vigente (cálculo)",
              value: rules ? (current ? `${current.schedule.name} · desde ${formatDate(current.validFrom)}` : "Nenhuma jornada atribuída") : "—",
            },
          ]}
        />
        <hr className="divider my-6" />
        <p className="eyebrow mb-2">Observações profissionais gerais</p>
        <p className="whitespace-pre-line text-sm text-muted">{employee.generalNotes || "Sem observações."}</p>
      </Panel>
      <div className="flex flex-col gap-5">
        {rules ? (
          <Panel title="Escala" actions={<Link href={`/frequencia/escala/${employee.id}`} className="btn btn-secondary btn-sm"><CalendarDays className="size-3.5" aria-hidden /> Ver calendário</Link>}>
            {rules.assignments.length === 0 ? (
              <p className="text-sm text-muted">Sem jornada atribuída. Atribua uma jornada para calcular horas previstas.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {[...rules.assignments].reverse().map((a) => (
                  <li key={a.id} className="border-b border-line pb-3 last:border-0">
                    <p>{a.schedule.name}</p>
                    <p className="text-xs text-subtle">
                      {formatDate(a.validFrom)} — {a.validTo ? formatDate(a.validTo) : "atual"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
        {can(actor, "employees:write") ? (
          <Panel title={inactive ? "Reativar" : "Inativar colaborador"} description={inactive ? undefined : "A inativação não exclui históricos. O colaborador deixa de aparecer nas listas ativas."}>
            {inactive ? (
              <ActionForm action={reactivateEmployeeAction.bind(null, employee.id)} className="flex flex-col gap-4">
                <SubmitButton variant="secondary">Reativar colaborador</SubmitButton>
                <FormMessage />
              </ActionForm>
            ) : (
              <ActionForm action={inactivateEmployeeAction.bind(null, employee.id)} className="flex flex-col gap-4">
                <TextAreaField name="reason" label="Motivo" required rows={2} maxLength={500} />
                <SubmitButton variant="danger" confirm="Confirmar a inativação? Os históricos serão mantidos.">Inativar</SubmitButton>
                <FormMessage />
              </ActionForm>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

async function Performance({ actor, employeeId }: { actor: Actor; employeeId: string }) {
  const [series, list] = await Promise.all([
    metricSeries(db, actor, { months: 12, employeeId }),
    listMetrics(db, actor, { employeeId, page: 1 }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Evolução — últimos 12 meses"
        actions={
          <>
            <Link href={`/desempenho?colaborador=${employeeId}`} className="btn btn-ghost btn-sm">Análise completa</Link>
            {can(actor, "metrics:write") ? <Link href="/desempenho/lancar" className="btn btn-secondary btn-sm"><Plus className="size-3.5" aria-hidden /> Lançar métricas do dia</Link> : null}
          </>
        }
      >
        {list.total === 0 ? (
          <EmptyState title="Sem métricas lançadas" description="Lance as métricas do dia para acompanhar a evolução deste colaborador." />
        ) : (
          <MetricTrend data={series} primaryLabel="Colaborador" />
        )}
      </Panel>
      {list.total > 0 ? (
        <Panel title="Lançamentos recentes">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Data</th><th className="text-right">Chamados</th><th className="text-right">TMA (min)</th><th className="text-right">Avaliação</th><th>Correções</th></tr>
              </thead>
              <tbody>
                {list.items.map((m) => (
                  <tr key={m.id}>
                    <td><Link className="link" href={`/desempenho/${m.id}`}>{formatDate(m.date)}</Link></td>
                    <td className="text-right tabular-nums">{m.ticketsHandled.toLocaleString("pt-BR")}</td>
                    <td className="text-right tabular-nums">{Number(m.avgHandleMinutes).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    <td className="text-right tabular-nums">{Number(m.avgRating).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    <td className="text-xs text-subtle">{m._count.revisions ? `${m._count.revisions} correção(ões)` : "Original"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

async function Attendance({ actor, employeeId }: { actor: Actor; employeeId: string }) {
  const t = today();
  const from = startOfMonth(t);
  const last30 = addDays(t, -29);
  const [month, rolling, occs] = await Promise.all([
    employeeAttendanceSummary(db, actor, employeeId, from, t),
    employeeAttendanceSummary(db, actor, employeeId, last30, t),
    listOccurrences(db, actor, { employeeId, page: 1 }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label="Previsto no mês (até hoje)" value={formatDuration(month.plannedMinutes)} hint={`${month.plannedDays} turno(s) · ${month.offDays} folga(s)`} />
        <Stat label="Ausências no mês" value={formatDuration(month.absenceMinutes)} />
        <Stat label="Ausências — 30 dias" value={formatDuration(rolling.absenceMinutes)} />
        <Stat label="Ajustes de escala — 30 dias" value={rolling.adjustedDays} />
      </div>
      <Panel
        title="Ocorrências"
        actions={
          <>
            <Link href={`/frequencia/escala/${employeeId}`} className="btn btn-ghost btn-sm"><CalendarDays className="size-3.5" aria-hidden /> Escala</Link>
            {can(actor, "attendance:write") ? <Link href={`/frequencia/ocorrencias/nova?colaborador=${employeeId}`} className="btn btn-secondary btn-sm"><Plus className="size-3.5" aria-hidden /> Registrar ocorrência</Link> : null}
          </>
        }
      >
        {occs.total === 0 ? (
          <EmptyState title="Nenhuma ocorrência registrada" description="Faltas, atestados, atrasos e ajustes de escala aparecerão aqui." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Data</th><th>Tipo</th><th>Horário</th><th>Conferência</th></tr></thead>
              <tbody>
                {occs.items.map((o) => (
                  <tr key={o.id}>
                    <td className="text-xs text-subtle"><Link className="link" href={`/frequencia/ocorrencias/${o.id}`}>{formatCode("occurrence", o.code)}</Link></td>
                    <td className="tabular-nums">{formatDate(o.date)}</td>
                    <td>{o.type.name}</td>
                    <td className="text-muted">{o.startMinute !== null && o.endMinute !== null ? formatTimeRange(o.startMinute, o.endMinute) : "Dia inteiro"}</td>
                    <td><LabelBadge map={REVIEW_STATUS} value={o.reviewStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {occs.total > occs.items.length ? (
          <Link href={`/frequencia?colaborador=${employeeId}`} className="link mt-4 inline-block text-xs">Ver todas as {occs.total} ocorrências</Link>
        ) : null}
      </Panel>
    </div>
  );
}

async function Feedbacks({ actor, employeeId }: { actor: Actor; employeeId: string }) {
  const list = await listFeedbacks(db, actor, { employeeId, page: 1 });
  return (
    <Panel
      title="Linha do tempo de feedbacks"
      actions={can(actor, "feedbacks:write") ? <Link href={`/feedbacks/novo?colaborador=${employeeId}`} className="btn btn-secondary btn-sm"><Plus className="size-3.5" aria-hidden /> Novo feedback</Link> : null}
    >
      {list.total === 0 ? (
        <EmptyState icon={<MessageSquareText className="size-6" />} title="Nenhum feedback registrado" description="Registre conversas de reconhecimento, desenvolvimento ou alinhamento." />
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {list.items.map((f) => (
            <li key={f.id} className="mb-6 ml-6 last:mb-0">
              <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border border-line-strong bg-canvas" aria-hidden />
              <p className="eyebrow">{formatDate(f.date)} · {formatCode("feedback", f.code)}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                <Link href={`/feedbacks/${f.id}`} className="link">{FEEDBACK_TYPE[f.type].label}</Link>
                <LabelBadge map={FEEDBACK_STATUS} value={f.status} />
                {f.followUpDate ? <span className="text-xs text-subtle">Acompanhar em {formatDate(f.followUpDate)}</span> : null}
              </p>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted">{f.context}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

async function Notes({ actor, employeeId, inactive }: { actor: Actor; employeeId: string; inactive: boolean }) {
  const notes = await listNotes(db, actor, employeeId);
  const t = today();
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <Panel title="Anotações profissionais" description="Separadas de feedbacks e de registros de frequência.">
        {notes.length === 0 ? (
          <EmptyState icon={<NotebookPen className="size-6" />} title="Nenhuma anotação" description="Registre observações objetivas e profissionais relevantes à supervisão." />
        ) : (
          <ul className="flex flex-col gap-5">
            {notes.map((n) => (
              <li key={n.id} id={`nota-${n.id}`} className="border-b border-line pb-5 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="eyebrow">{formatDate(n.date)}</p>
                  <LabelBadge map={NOTE_CATEGORY} value={n.category} />
                </div>
                <p className="mt-2 font-medium">{n.title}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{n.content}</p>
                {can(actor, "notes:write") ? (
                  <div className="mt-2 flex gap-2">
                    <Link href={`/colaboradores/${employeeId}/anotacoes/${n.id}`} className="btn btn-ghost btn-sm">Editar</Link>
                    <ActionForm action={deleteNoteAction.bind(null, n.id, employeeId)}>
                      <SubmitButton variant="ghost" className="btn-sm" confirm="Excluir esta anotação?">Excluir</SubmitButton>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {can(actor, "notes:write") && !inactive ? (
        <Panel title="Nova anotação">
          <ActionForm action={createNoteAction} resetOnSuccess className="flex flex-col gap-5">
            <Hidden name="employeeId" value={employeeId} />
            <TextField name="date" label="Data" type="date" required defaultValue={toDateKey(t)} />
            <SelectField name="category" label="Categoria" options={options(NOTE_CATEGORY)} defaultValue="OBSERVATION" />
            <TextField name="title" label="Título" required maxLength={160} />
            <TextAreaField name="content" label="Conteúdo" required rows={5} maxLength={4000} hint="Evite informações pessoais irrelevantes, de saúde ou impressões subjetivas." />
            <SubmitButton>Registrar anotação</SubmitButton>
            <FormMessage />
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
