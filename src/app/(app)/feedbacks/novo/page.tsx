import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { readParams } from "@/lib/validation";
import { employeeOptions } from "@/modules/employees/service";
import { createFeedbackAction } from "@/modules/feedbacks/actions";
import { PageHeader } from "@/components/ui/primitives";
import { FeedbackForm } from "../feedback-form";

export const metadata: Metadata = { title: "Novo feedback" };

export default async function NewFeedbackPage(props: PageProps<"/feedbacks/novo">) {
  const actor = await requirePermission("feedbacks:write");
  const params = readParams(await props.searchParams);
  const employees = await employeeOptions(db, actor);
  return (
    <>
      <PageHeader eyebrow="Feedbacks" title="Novo feedback" />
      <FeedbackForm action={createFeedbackAction} defaults={{ employeeId: params.colaborador, date: today() }} employees={employees} cancelHref="/feedbacks" submitLabel="Registrar feedback" />
    </>
  );
}
