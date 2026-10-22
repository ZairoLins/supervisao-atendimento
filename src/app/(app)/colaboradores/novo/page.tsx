import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { distinctTeamsAndTitles } from "@/modules/employees/service";
import { createEmployeeAction } from "@/modules/employees/actions";
import { PageHeader } from "@/components/ui/primitives";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Novo colaborador" };

export default async function NewEmployeePage() {
  await requirePermission("employees:write");
  const { teams, titles } = await distinctTeamsAndTitles(db);
  return (
    <>
      <PageHeader eyebrow="Colaboradores" title="Novo colaborador" description="O identificador interno (COL-0000) é gerado automaticamente e não muda com alterações cadastrais." />
      <EmployeeForm action={createEmployeeAction} teams={teams} titles={titles} cancelHref="/colaboradores" submitLabel="Cadastrar" />
    </>
  );
}
