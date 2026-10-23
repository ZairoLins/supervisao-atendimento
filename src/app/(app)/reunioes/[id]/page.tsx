import type { Metadata } from "next";
import Link from "next/link";
import { Check, Megaphone, Pencil, Send, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { MEETING_STATUS, MEETING_TYPE } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getMeeting } from "@/modules/meetings/service";
import {
  addDecisionAction,
  deleteMeetingAction,
  removeDecisionAction,
  saveAgendaAction,
  saveMinutesAction,
  setAttendanceAction,
  templateFromMeetingAction,
  toggleAgendaTaskAction,
} from "@/modules/meetings/actions";
import { agendaStats } from "@/lib/markdown";
import { lastMessagesFor } from "@/modules/whatsapp/service";
import { sendMeetingAgendaAction, sendMeetingReminderAction } from "@/modules/whatsapp/actions";
import { Markdown } from "@/components/ui/markdown";
import { MarkdownField } from "@/components/ui/markdown-field";
import { AGENDA_HINT } from "../meeting-form";
import { ActionForm, CheckboxField, CheckboxGroup, FormMessage, Hidden, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reunião" };

export default async function MeetingPage(props: PageProps<"/reunioes/[id]">) {
  const actor = await requirePermission("meetings:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const m = await orNotFound(getMeeting(db, actor, id));
  const canWrite = can(actor, "meetings:write");
  const stats = agendaStats(m.agenda);
  const canSend = can(actor, "messages:send");
  const sent = canSend ? await lastMessagesFor(db, m.id) : [];
  const tz = env().APP_TIMEZONE;

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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          {/* 1. Pauta planejada */}
          <section id="pauta" className="scroll-mt-24">
            <Panel
              title="1 · Pauta planejada"
              description={stats.items ? `O que se planejou discutir · ${stats.done} de ${stats.items} item(ns) discutido(s).` : "O que se planejou discutir."}
            >
              {m.agenda.trim() ? (
                <Markdown
                  className="mb-5"
                  renderTask={
                    canWrite
                      ? (line, checked) => (
                          <ActionForm action={toggleAgendaTaskAction.bind(null, id)}>
                            <Hidden name="line" value={line} />
                            <button
                              type="submit"
                              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-primary bg-primary text-white" : "border-line-strong bg-surface hover:border-primary"}`}
                              aria-label={checked ? "Marcar como não discutido" : "Marcar como discutido"}
                              title={checked ? "Marcar como não discutido" : "Marcar como discutido"}
                            >
                              {checked ? <Check className="size-3.5" aria-hidden /> : null}
                            </button>
                          </ActionForm>
                        )
                      : undefined
                  }
                >
                  {m.agenda}
                </Markdown>
              ) : (
                <p className="mb-4 text-sm text-muted">Pauta vazia.</p>
              )}
              {canWrite ? (
                <details className="group border-t border-line pt-4" open={!m.agenda.trim()}>
                  <summary className="btn btn-secondary btn-sm cursor-pointer list-none">
                    <Pencil className="size-3.5" aria-hidden /> {m.agenda.trim() ? "Editar pauta" : "Escrever pauta"}
                  </summary>
                  {/* key: remonta o editor quando a pauta muda (ex.: item marcado como discutido) */}
                  <ActionForm key={m.agenda} action={saveAgendaAction.bind(null, id)} className="mt-4 flex flex-col gap-4">
                    <MarkdownField name="agenda" label="Pauta (Markdown)" rows={12} maxLength={20000} defaultValue={m.agenda} hint={AGENDA_HINT} />
                    <div className="flex flex-wrap items-center gap-3"><SubmitButton>Salvar pauta</SubmitButton><FormMessage /></div>
                  </ActionForm>
                </details>
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
          <Panel title="3 · Decisões e encaminhamentos" description="O que ficou decidido e os próximos passos combinados.">
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
              <ActionForm action={addDecisionAction.bind(null, id)} resetOnSuccess className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <TextField name="description" label="Nova decisão ou encaminhamento" required maxLength={1000} />
                <SubmitButton variant="secondary" className="btn-sm">Registrar</SubmitButton>
                <div className="sm:col-span-2"><FormMessage /></div>
              </ActionForm>
            ) : null}

          </Panel>
        </div>

        <div className="flex flex-col gap-5">
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
          {canSend ? (
            <Panel title="Enviar pelo WhatsApp" description="A pauta vai formatada (negrito, listas e checklist).">
              <div className="flex flex-col gap-4">
                <ActionForm action={sendMeetingAgendaAction.bind(null, id)} className="flex flex-col gap-2">
                  <SubmitButton variant="secondary" className="btn-sm self-start" confirm="Enviar a pauta desta reunião ao gestor?"><Send className="size-3.5" aria-hidden /> Enviar pauta ao gestor</SubmitButton>
                  <FormMessage />
                </ActionForm>
                <ActionForm action={sendMeetingReminderAction.bind(null, id)} className="flex flex-col gap-2">
                  <SubmitButton variant="secondary" className="btn-sm self-start" confirm={m.reminderSentAt ? "O aviso já foi enviado. Enviar de novo ao grupo?" : "Enviar o aviso desta reunião ao grupo?"}>
                    <Megaphone className="size-3.5" aria-hidden /> Avisar o grupo
                  </SubmitButton>
                  <p className="text-xs text-subtle">
                    {m.reminderSentAt ? `Aviso enviado em ${formatDateTime(m.reminderSentAt, tz)}.` : m.type === "WEEKLY" ? "Reunião semanal: o aviso automático é enviado se estiver ativado em WhatsApp." : "Aviso ainda não enviado."}
                  </p>
                  <FormMessage />
                </ActionForm>
                {sent.length ? (
                  <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-subtle">
                    {sent.map((s) => (
                      <li key={s.id}>
                        {formatDateTime(s.createdAt, tz)} · {s.kind === "MEETING_AGENDA" ? "pauta ao gestor" : "aviso ao grupo"} · {s.status === "SENT" ? "enviado" : <span className="text-danger">falhou</span>}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Panel>
          ) : null}
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
                <p className="text-xs text-subtle">Exclusão lógica: o registro fica guardado na auditoria.</p>
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
