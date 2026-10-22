import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { assertUuid, orNotFound } from "@/lib/page";
import { distinctTeamsAndTitles, getEmployee } from "@/modules/employees/service";
import { updateEmployeeAction } from "@/modules/employees/actions";
import { PageHeader } from "@/components/ui/primitives";
import { EmployeeForm } from "../../employee-form";

export const metadata: Metadata = { title: "Editar colaborador" };

export default async function EditEmployeePage(props: PageProps<"/colaboradores/[id]/editar">) {
  const actor = await requirePermission("employees:write");
  const id = assertUuid((await props.params).id);
  const [employee, { teams, titles }] = await Promise.all([orNotFound(getEmployee(db, actor, id)), distinctTeamsAndTitles(db)]);
  if (employee.status === "INACTIVE") redirect(`/colaboradores/${id}`);
  return (
    <>
      <PageHeader eyebrow="Colaboradores" title={`Editar ${employee.fullName}`} />
      <EmployeeForm
        action={updateEmployeeAction.bind(null, id)}
        defaults={employee}
        teams={teams}
        titles={titles}
        cancelHref={`/colaboradores/${id}`}
        submitLabel="Salvar alterações"
      />
    </>
  );
}
