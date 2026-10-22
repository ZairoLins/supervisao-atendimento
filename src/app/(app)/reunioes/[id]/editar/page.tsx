import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound } from "@/lib/page";
import { getMeeting } from "@/modules/meetings/service";
import { employeeOptions } from "@/modules/employees/service";
import { updateMeetingAction } from "@/modules/meetings/actions";
import { PageHeader } from "@/components/ui/primitives";
import { MeetingForm } from "../../meeting-form";

export const metadata: Metadata = { title: "Editar reunião" };

export default async function EditMeetingPage(props: PageProps<"/reunioes/[id]/editar">) {
  const actor = await requirePermission("meetings:write");
  const id = assertUuid((await props.params).id);
  const m = await orNotFound(getMeeting(db, actor, id));
  const participantIds = m.participants.map((p) => p.employeeId);
  const employees = can(actor, "employees:read") ? await employeeOptions(db, actor, { includeInactive: true }) : [];
  // Mantém participantes inativos já vinculados, sem oferecer novos inativos
  const visible = employees.filter((e) => !e.label.endsWith("(inativo)") || participantIds.includes(e.value));
  return (
    <>
      <PageHeader eyebrow="Reuniões" title={`Editar: ${m.title}`} />
      <MeetingForm action={updateMeetingAction.bind(null, id)} defaults={{ ...m, participantIds }} employees={visible} isEdit cancelHref={`/reunioes/${id}`} />
    </>
  );
}
