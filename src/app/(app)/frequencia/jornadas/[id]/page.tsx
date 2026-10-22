import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { assertUuid } from "@/lib/page";
import { notFound } from "next/navigation";
import { updateScheduleAction } from "@/modules/attendance/actions";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ScheduleForm } from "../schedule-form";

export const metadata: Metadata = { title: "Editar jornada" };

export default async function EditSchedulePage(props: PageProps<"/frequencia/jornadas/[id]">) {
  await requirePermission("attendance:write");
  const id = assertUuid((await props.params).id);
  const s = await db.workSchedule.findUnique({
    where: { id },
    include: { segments: { orderBy: { position: "asc" } }, _count: { select: { assignments: true } } },
  });
  if (!s) notFound();
  return (
    <>
      <PageHeader eyebrow="Jornadas" title={s.name} />
      <Panel className="max-w-3xl">
        <ScheduleForm action={updateScheduleAction.bind(null, id)} defaults={s} locked={s._count.assignments > 0} isEdit />
      </Panel>
    </>
  );
}
