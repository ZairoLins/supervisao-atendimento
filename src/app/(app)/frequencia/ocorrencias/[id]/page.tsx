import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Lock, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatDate, formatTimeRange } from "@/lib/dates";
import { REVIEW_STATUS } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getOccurrence, planForDate } from "@/modules/attendance/occurrences";
import { deleteOccurrenceAction, removeAttachmentAction, reviewOccurrenceAction, uploadAttachmentAction } from "@/modules/attendance/actions";
import { ActionForm, FormMessage, Hidden, SubmitButton, TextAreaField } from "@/components/ui/form";
import { FileField } from "@/components/ui/file-field";
import { Badge, DescriptionList, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";
import { AuditTrail } from "@/components/audit-trail";

export const metadata: Metadata = { title: "Ocorrência" };

export default async function OccurrencePage(props: PageProps<"/frequencia/ocorrencias/[id]">) {
  const actor = await requirePermission("attendance:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const o = await orNotFound(getOccurrence(db, actor, id));
  const plan = await planForDate(db, o.employeeId, o.date);
  const canWrite = can(actor, "attendance:write");
  const canRestricted = can(actor, "attendance:restricted");
  const attachments = "attachments" in o && Array.isArray(o.attachments) ? o.attachments : [];

  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("occurrence", o.code)} · Frequência`}
        title={`${o.type.name} — ${o.employee.fullName}`}
        description={<span className="flex flex-wrap items-center gap-2"><LabelBadge map={REVIEW_STATUS} value={o.reviewStatus} /> {formatDate(o.date)}</span>}
        actions={
          canWrite && !o.adjustmentId ? (
            <Link href={`/frequencia/ocorrencias/${o.id}/editar`} className="btn btn-secondary"><Pencil className="size-3.5" aria-hidden /> Corrigir</Link>
          ) : null
        }
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Ocorrência salva.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Registro">
            <DescriptionList
              items={[
                { label: "Colaborador", value: <Link className="link" href={`/colaboradores/${o.employee.id}?aba=frequencia`}>{o.employee.fullName}</Link> },
                { label: "Tipo", value: <span className="flex flex-wrap gap-2">{o.type.name}{o.type.countsAsAbsence ? null : <Badge tone="neutral">Não desconta horas</Badge>}</span> },
                { label: "Data do turno", value: formatDate(o.date) },
                { label: "Período", value: o.startMinute !== null && o.endMinute !== null ? formatTimeRange(o.startMinute, o.endMinute) : "Turno inteiro" },
                {
                  label: "Escala efetiva na data",
                  value: plan.effective.isWorkDay ? plan.effective.segments.map((s) => formatTimeRange(s.startMinute, s.endMinute)).join(" e ") : "Folga / sem turno previsto",
                },
                { label: "Jornada vigente", value: plan.scheduleName ?? "Sem jornada atribuída" },
              ]}
            />
            <hr className="divider my-6" />
            <p className="eyebrow mb-2">Observação administrativa</p>
            <p className="whitespace-pre-line text-sm text-muted">{o.adminNotes || "—"}</p>
            {canRestricted ? (
              <>
                <p className="eyebrow mb-2 mt-6 flex items-center gap-1.5"><Lock className="size-3" aria-hidden /> Informação restrita</p>
                <p className="whitespace-pre-line text-sm text-muted">{o.restrictedNotes || "—"}</p>
              </>
            ) : o.hasRestricted ? (
              <p className="mt-6 flex items-center gap-1.5 text-xs text-subtle"><Lock className="size-3" aria-hidden /> Existe informação restrita, visível apenas para perfis autorizados.</p>
            ) : null}
            {o.adjustment ? (
              <div className="mt-6">
                <Notice tone="info">
                  Gerada por {o.adjustment.kind === "DAY_OFF" ? "folga/troca" : "ajuste de horário"} na escala{o.adjustment.revokedAt ? " (ajuste revogado)" : ""}. Para alterar, use a{" "}
                  <Link className="link" href={`/frequencia/escala/${o.employeeId}`}>escala do colaborador</Link>.
                </Notice>
              </div>
            ) : null}
          </Panel>
          <AuditTrail actor={actor} entityType="AttendanceOccurrence" entityId={o.id} />
        </div>

        <div className="flex flex-col gap-5">
          {canWrite ? (
            <Panel title="Conferência">
              <div className="flex flex-wrap gap-2">
                {(["PENDING", "CONFIRMED", "DISREGARDED"] as const)
                  .filter((s) => s !== o.reviewStatus)
                  .map((s) => (
                    <ActionForm key={s} action={reviewOccurrenceAction.bind(null, o.id)}>
                      <Hidden name="status" value={s} />
                      <SubmitButton variant="secondary" className="btn-sm">Marcar como {REVIEW_STATUS[s].label.toLowerCase()}</SubmitButton>
                    </ActionForm>
                  ))}
              </div>
              <p className="mt-3 text-xs text-subtle">“Desconsiderado” exclui a ocorrência do cálculo de horas, sem apagá-la.</p>
            </Panel>
          ) : null}

          {canRestricted ? (
            <Panel title="Anexos (privados)">
              {attachments.length === 0 ? <p className="mb-4 text-sm text-muted">Nenhum anexo.</p> : (
                <ul className="mb-5 flex flex-col gap-3">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                      <a href={`/api/anexos/${a.id}`} className="link inline-flex min-w-0 items-center gap-2" target="_blank" rel="noopener">
                        <FileText className="size-4 shrink-0" aria-hidden /> <span className="truncate">{a.originalName}</span>
                      </a>
                      {canWrite ? (
                        <ActionForm action={removeAttachmentAction.bind(null, a.id, o.id)}>
                          <SubmitButton variant="ghost" className="btn-sm" confirm="Remover este anexo?">Remover</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite ? (
                <ActionForm action={uploadAttachmentAction.bind(null, o.id)} resetOnSuccess className="flex flex-col gap-3">
                  <FileField name="file" label="Adicionar anexo" hint="PDF, PNG ou JPG até 10 MB. Não é publicado por URL pública." />
                  <SubmitButton variant="secondary" className="btn-sm self-start">Enviar</SubmitButton>
                  <FormMessage />
                </ActionForm>
              ) : null}
            </Panel>
          ) : null}

          {canWrite && !o.adjustmentId ? (
            <Panel title="Excluir">
              <ActionForm action={deleteOccurrenceAction.bind(null, o.id)} className="flex flex-col gap-4">
                <TextAreaField name="reason" label="Motivo da exclusão" required rows={2} maxLength={500} />
                <SubmitButton variant="danger" confirm="Excluir esta ocorrência? Ela continuará registrada na auditoria.">Excluir ocorrência</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
