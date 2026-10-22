import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { readParams, safeDateParam } from "@/lib/validation";
import { listOccurrenceTypes } from "@/modules/attendance/occurrences";
import { employeeOptions } from "@/modules/employees/service";
import { createOccurrenceAction } from "@/modules/attendance/actions";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { OccurrenceForm } from "../occurrence-form";

export const metadata: Metadata = { title: "Registrar ocorrência" };

export default async function NewOccurrencePage(props: PageProps<"/frequencia/ocorrencias/nova">) {
  const actor = await requirePermission("attendance:write");
  const params = readParams(await props.searchParams);
  const [employees, types] = await Promise.all([employeeOptions(db, actor), listOccurrenceTypes(db, actor)]);
  return (
    <>
      <PageHeader eyebrow="Frequência" title="Registrar ocorrência" description="Para trocas de plantão e ajustes de escala, use a escala do colaborador — a escala prevista é preservada." />
      {employees.length === 0 ? (
        <EmptyState title="Nenhum colaborador ativo" description="Cadastre colaboradores antes de registrar ocorrências." action={<Link href="/colaboradores/novo" className="btn btn-primary">Cadastrar colaborador</Link>} />
      ) : (
        <OccurrenceForm
          action={createOccurrenceAction}
          employees={employees}
          types={types}
          defaults={{ employeeId: params.colaborador, date: safeDateParam(params.data) ?? today() }}
          canRestricted={can(actor, "attendance:restricted")}
          isEdit={false}
          cancelHref="/frequencia"
        />
      )}
    </>
  );
}
