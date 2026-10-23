import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatDate } from "@/lib/dates";
import { FEEDBACK_STATUS, FEEDBACK_TYPE } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { readParams } from "@/lib/validation";
import { getFeedback } from "@/modules/feedbacks/service";
import { deleteFeedbackAction } from "@/modules/feedbacks/actions";
import { ActionForm, FormMessage, SubmitButton } from "@/components/ui/form";
import { DescriptionList, LabelBadge, Notice, PageHeader, Panel } from "@/components/ui/primitives";
import { AuditTrail } from "@/components/audit-trail";

export const metadata: Metadata = { title: "Feedback" };

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      <p className="whitespace-pre-line text-sm text-muted">{value || "—"}</p>
    </div>
  );
}

export default async function FeedbackPage(props: PageProps<"/feedbacks/[id]">) {
  const actor = await requirePermission("feedbacks:read");
  const id = assertUuid((await props.params).id);
  const params = readParams(await props.searchParams);
  const fb = await orNotFound(getFeedback(db, actor, id));
  const canWrite = can(actor, "feedbacks:write");
  return (
    <>
      <PageHeader
        eyebrow={`${formatCode("feedback", fb.code)} · ${formatDate(fb.date)}`}
        title={`${FEEDBACK_TYPE[fb.type].label} — ${fb.employee.fullName}`}
        description={<LabelBadge map={FEEDBACK_STATUS} value={fb.status} />}
        actions={canWrite ? <Link href={`/feedbacks/${id}/editar`} className="btn btn-secondary"><Pencil className="size-3.5" aria-hidden /> Editar</Link> : null}
      />
      {params.salvo ? <div className="mb-6"><Notice tone="ok">Feedback salvo.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <Panel>
            <div className="flex flex-col gap-6">
              <Block label="Contexto profissional" value={fb.context} />
              <hr className="divider" />
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Block label="Pontos positivos" value={fb.positives} />
                <Block label="Pontos a desenvolver" value={fb.improvements} />
              </div>
              <hr className="divider" />
              <Block label="Ações acordadas" value={fb.agreedActions} />
            </div>
          </Panel>
          <AuditTrail actor={actor} entityType="Feedback" entityId={fb.id} />
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="Acompanhamento">
            <DescriptionList
              items={[
                { label: "Colaborador", value: <Link className="link" href={`/colaboradores/${fb.employee.id}?aba=feedbacks`}>{fb.employee.fullName}</Link> },
                { label: "Prazo de acompanhamento", value: formatDate(fb.followUpDate) },
                { label: "Data de revisão", value: formatDate(fb.reviewDate) },
                { label: "Situação", value: FEEDBACK_STATUS[fb.status].label },
              ]}
            />
          </Panel>
          {canWrite ? (
            <Panel title="Excluir">
              <ActionForm action={deleteFeedbackAction.bind(null, id)} className="flex flex-col gap-3">
                <SubmitButton variant="danger" className="btn-sm self-start" confirm="Excluir este feedback?">Excluir feedback</SubmitButton>
                <FormMessage />
              </ActionForm>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
