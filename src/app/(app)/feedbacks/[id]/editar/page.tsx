import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatCode } from "@/lib/text";
import { getFeedback } from "@/modules/feedbacks/service";
import { employeeOptions } from "@/modules/employees/service";
import { updateFeedbackAction } from "@/modules/feedbacks/actions";
import { PageHeader } from "@/components/ui/primitives";
import { FeedbackForm } from "../../feedback-form";

export const metadata: Metadata = { title: "Editar feedback" };

export default async function EditFeedbackPage(props: PageProps<"/feedbacks/[id]/editar">) {
  const actor = await requirePermission("feedbacks:write");
  const id = assertUuid((await props.params).id);
  const fb = await orNotFound(getFeedback(db, actor, id));
  const employees = await employeeOptions(db, actor, { includeId: fb.employeeId });
  return (
    <>
      <PageHeader eyebrow={formatCode("feedback", fb.code)} title="Editar feedback" />
      <FeedbackForm action={updateFeedbackAction.bind(null, id)} defaults={fb} employees={employees} cancelHref={`/feedbacks/${id}`} submitLabel="Salvar alterações" />
    </>
  );
}
