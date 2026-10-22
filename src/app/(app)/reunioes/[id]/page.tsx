import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Pencil, Trash2, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound, today } from "@/lib/page";
import { formatDate, formatTime } from "@/lib/dates";
import { MEETING_STATUS, MEETING_TYPE, TASK_PRIORITY, TASK_STATUS, options } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getMeeting } from "@/modules/meetings/service";
import { assigneeOptions, isOverdue } from "@/modules/tasks/service";
import {
  addAgendaItemAction,
  addDecisionAction,
  addMeetingTaskAction,
  agendaCommandAction,
  deleteMeetingAction,
  removeDecisionAction,
  saveMinutesAction,
  setAttendanceAction,
  templateFromMeetingAction,
} from "@/modules/meetings/actions";
import { ActionForm, CheckboxField, CheckboxGroup, FormMessage, Hidden, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reunião" };

export default async function MeetingPage(props: PageProps<"/reunioes/[id]">) {
  const actor = await requirePermission("meetings:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const m = await orNotFound(getMeeting(db, actor, id));
  const canWrite = can(actor, "meetings:write");
  const canTask = can(actor, "tasks:write");
  const assignees = canTask ? await assigneeOptions(db, actor) : [];
  const t = today();

  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("meeting", m.code)} · ${formatDate(m.date)} · ${formatTime(m.startMinute)}${m.endMinute ? `–${formatTime(m.endMinute)}` : ""}`}
        title={m.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LabelBadge map={MEETING_TYPE} value={m.type} />
            <LabelBadge map={MEETING_STATUS} value={m.status} />
            {m.location ? <span>{m.location}</span> : null}
            {m.series ? <span className="text-subtle">· série semanal</span> : null}
          </span>
        }
        actions={canWrite ? <Link href={`/reunioes/${id}/editar`} className="btn btn-secondary"><Pencil className="size-3.5" aria-hidden /> Editar</Link> : null}
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Reunião salva.</Notice></div> : null}

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-[18px]">
          {/* 1. Pauta planejada */}
          <section id="pauta" className="scroll-mt-24">
            <Panel title="1 · Pauta planejada" description="O que se planejou discutir.">
              {m.agendaItems.length === 0 ? <p className="mb-4 text-sm text-muted">Pauta vazia.</p> : (
                <ol className="mb-5 flex flex-col">
                  {m.agendaItems.map((item, idx) => (
                    <li key={item.id} className="flex items-start gap-3 border-b border-dashed border-cork py-3 first:pt-0 last:border-0">
                      <span className="w-6 shrink-0 pt-0.5 text-xs tabular-nums text-subtle">{idx + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className={item.discussed ? "text-muted line-through decoration-driftwood" : ""}>{item.title}</p>
                        {item.description ? <p className="mt-0.5 text-xs text-subtle">{item.description}</p> : null}
                        {item.discussed ? <span className="mt-1 inline-block"><Badge tone="ok">Discutido</Badge></span> : null}
                      </div>
                      {canWrite ? (
                        <div className="flex shrink-0 gap-0.5">
                          {[
                            { cmd: "up", label: "Mover para cima", icon: ArrowUp, hide: idx === 0 },
                            { cmd: "down", label: "Mover para baixo", icon: ArrowDown, hide: idx === m.agendaItems.length - 1 },
                            { cmd: "toggle", label: item.discussed ? "Marcar como não discutido" : "Marcar como discutido", icon: item.discussed ? Undo2 : Check, hide: false },
                            { cmd: "remove", label: "Remover item", icon: Trash2, hide: false },
                          ]
                            .filter((b) => !b.hide)
                            .map((b) => (
                              <ActionForm key={b.cmd} action={agendaCommandAction.bind(null, item.id, id)}>
                                <Hidden name="cmd" value={b.cmd} />
                                <button type="submit" className="btn btn-ghost btn-sm px-2" aria-label={b.label} title={b.label}>
                                  <b.icon className="size-3.5" aria-hidden />
                                </button>
                              </ActionForm>
                            ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {canWrite ? (
                <ActionForm action={addAgendaItemAction.bind(null, id)} resetOnSuccess className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <TextField name="title" label="Novo item da pauta" required maxLength={300} />
                  <SubmitButton variant="secondary" className="btn-sm">Adicionar</SubmitButton>
                  <div className="sm:col-span-2"><FormMessage /></div>
                </ActionForm>
              ) : null}
            </Panel>
          </section>

          {/* 2. Anotações */}
          <Panel title="2 · Anotações da reunião (ata)" description="O que foi efetivamente discutido.">
            {canWrite ? (
              <ActionForm action={saveMinutesAction.bind(null, id)} className="flex flex-col gap-4">
                <TextAreaField name="minutes" label="Anotações" rows={10} defaultValue={m.minutes} maxLength={20000} />
                {m.status !== "DONE" ? <CheckboxField name="markDone" label="Marcar reunião como realizada" /> : null}
                <div className="flex flex-wrap items-center gap-3"><SubmitButton>Salvar ata</SubmitButton><FormMessage /></div>
              </ActionForm>
            ) : (
              <p className="whitespace-pre-line text-sm text-muted">{m.minutes || "Sem anotações."}</p>
            )}
          </Panel>

          {/* 3. Decisões e encaminhamentos */}
          <Panel title="3 · Decisões e encaminhamentos" description="Ações definidas viram tarefas com responsável e prazo.">
            <p className="eyebrow mb-3">Decisões</p>
            {m.decisions.length === 0 ? <p className="mb-4 text-sm text-muted">Nenhuma decisão registrada.</p> : (
              <ul className="mb-5 flex flex-col gap-2">
                {m.decisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>— {d.description}</span>
                    {canWrite ? (
                      <ActionForm action={removeDecisionAction.bind(null, d.id, id)}>
                        <button type="submit" className="btn btn-ghost btn-sm px-2" aria-label="Remover decisão"><Trash2 className="size-3.5" aria-hidden /></button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <ActionForm action={addDecisionAction.bind(null, id)} resetOnSuccess className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="description" label="Nova decisão" required maxLength={1000} />
                <SubmitButton variant="secondary" className="btn-sm">Registrar</SubmitButton>
                <div className="sm:col-span-2"><FormMessage /></div>
              </ActionForm>
            ) : null}

            <hr className="divider my-6" />
            <p className="eyebrow mb-3">Ações (tarefas vinculadas)</p>
            {m.tasks.length === 0 ? <p className="mb-4 text-sm text-muted">Nenhuma ação definida.</p> : (
              <ul className="mb-5 flex flex-col gap-3">
                {m.tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link className="link" href={`/tarefas/${task.id}`}>{task.title}</Link>
                    <LabelBadge map={TASK_STATUS} value={task.status} />
                    <span className="text-xs text-subtle">
                      {task.assigneeEmployee?.fullName ?? task.assigneeUser?.name ?? "Sem responsável"} · {task.dueDate ? `prazo ${formatDate(task.dueDate)}` : "sem prazo"}
                    </span>
                    {isOverdue(task, t) ? <Badge tone="danger">Atrasada</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
            {canTask ? (
              <ActionForm action={addMeetingTaskAction.bind(null, id)} resetOnSuccess className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField name="title" label="Nova ação" required className="sm:col-span-2" maxLength={200} />
                <SelectField name="assignee" label="Responsável" options={assignees} placeholder="Sem responsável" />
                <TextField name="dueDate" label="Prazo" type="date" />
                <SelectField name="priority" label="Prioridade" options={options(TASK_PRIORITY)} defaultValue="MEDIUM" />
                <div className="flex items-end"><SubmitButton variant="secondary" className="btn-sm">Criar ação</SubmitButton></div>
                <div className="sm:col-span-2"><FormMessage /></div>
              </ActionForm>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-[18px]">
          <Panel title="Participantes">
            {m.participants.length === 0 ? <p className="text-sm text-muted">Nenhum participante definido.</p> : canWrite ? (
              <ActionForm action={setAttendanceAction.bind(null, id)} className="flex flex-col gap-4">
                <CheckboxGroup
                  name="attended"
                  label="Presença"
                  columns={1}
                  options={m.participants.map((p) => ({ value: p.employeeId, label: p.employee.fullName }))}
                  defaultValues={m.participants.filter((p) => p.attended).map((p) => p.employeeId)}
                />
                <div className="flex flex-wrap items-center gap-3"><SubmitButton variant="secondary" className="btn-sm">Salvar presenças</SubmitButton><FormMessage /></div>
              </ActionForm>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {m.participants.map((p) => (
                  <li key={p.employeeId} className="flex items-center gap-2">{p.employee.fullName}{p.attended ? <Badge tone="ok">Presente</Badge> : null}</li>
                ))}
              </ul>
            )}
          </Panel>
          {canWrite ? (
            <Panel title="Reutilizar pauta" description="Salve a pauta atual como modelo para próximas reuniões.">
              <ActionForm action={templateFromMeetingAction.bind(null, id)} resetOnSuccess className="flex flex-col gap-4">
                <TextField name="name" label="Nome do modelo" required maxLength={120} />
                <SubmitButton variant="secondary" className="btn-sm self-start">Salvar como modelo</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          ) : null}
          {canWrite ? (
            <Panel title="Excluir reunião">
              <ActionForm action={deleteMeetingAction.bind(null, id)} className="flex flex-col gap-3">
                <p className="text-xs text-subtle">Exclusão lógica: tarefas vinculadas são mantidas.</p>
                <SubmitButton variant="danger" className="btn-sm self-start" confirm="Excluir esta reunião?">Excluir</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
