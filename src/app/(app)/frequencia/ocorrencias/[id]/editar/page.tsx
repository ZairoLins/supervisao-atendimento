import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { assertUuid, orNotFound } from "@/lib/page";
import { formatCode } from "@/lib/text";
import { getOccurrence, listOccurrenceTypes } from "@/modules/attendance/occurrences";
import { employeeOptions } from "@/modules/employees/service";
import { updateOccurrenceAction } from "@/modules/attendance/actions";
import { PageHeader } from "@/components/ui/primitives";
import { OccurrenceForm } from "../../occurrence-form";

export const metadata: Metadata = { title: "Corrigir ocorrência" };

export default async function EditOccurrencePage(props: PageProps<"/frequencia/ocorrencias/[id]/editar">) {
  const actor = await requirePermission("attendance:write");
  const id = assertUuid((await props.params).id);
  const o = await orNotFound(getOccurrence(db, actor, id));
  if (o.adjustmentId) redirect(`/frequencia/ocorrencias/${id}`);
  const [employees, types] = await Promise.all([employeeOptions(db, actor, { includeId: o.employeeId }), listOccurrenceTypes(db, actor, { includeInactive: true })]);
  return (
    <>
      <PageHeader eyebrow={formatCode("occurrence", o.code)} title="Corrigir ocorrência" description="A correção mantém o registro original na auditoria, com o motivo informado." />
      <OccurrenceForm
        action={updateOccurrenceAction.bind(null, id)}
        employees={employees}
        types={types.filter((t) => t.active || t.id === o.typeId)}
        defaults={o}
        canRestricted={can(actor, "attendance:restricted")}
        isEdit
        cancelHref={`/frequencia/ocorrencias/${id}`}
      />
    </>
  );
}
