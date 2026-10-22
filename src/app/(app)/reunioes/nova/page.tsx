import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { listTemplates, meetingOptions } from "@/modules/meetings/service";
import { employeeOptions } from "@/modules/employees/service";
import { createMeetingAction } from "@/modules/meetings/actions";
import { PageHeader } from "@/components/ui/primitives";
import { MeetingForm } from "../meeting-form";

export const metadata: Metadata = { title: "Nova reunião" };

export default async function NewMeetingPage() {
  const actor = await requirePermission("meetings:write");
  const [employees, templates, previous] = await Promise.all([
    can(actor, "employees:read") ? employeeOptions(db, actor) : Promise.resolve([]),
    listTemplates(db, actor),
    meetingOptions(db, actor),
  ]);
  return (
    <>
      <PageHeader eyebrow="Reuniões" title="Nova reunião" description="Para a reunião semanal recorrente, use Modelos e recorrência." />
      <MeetingForm
        action={createMeetingAction}
        defaults={{ date: today() }}
        employees={employees}
        templates={templates.map((t) => ({ value: t.id, label: t.name }))}
        previousMeetings={previous}
        isEdit={false}
        cancelHref="/reunioes"
      />
    </>
  );
}
