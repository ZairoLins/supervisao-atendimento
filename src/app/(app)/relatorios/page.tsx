import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can, type Permission } from "@/lib/permissions";
import { FEEDBACK_TYPE, MEETING_TYPE, options } from "@/lib/labels";
import { REPORT_KINDS, type ReportKind } from "@/modules/reports/types";
import { distinctTeamsAndTitles, employeeOptions } from "@/modules/employees/service";
import { listOccurrenceTypes } from "@/modules/attendance/occurrences";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Relatórios" };

const REQUIRED: Record<ReportKind, Permission> = {
  semanal: "metrics:read",
  metricas: "metrics:read",
  desempenho: "metrics:read",
  frequencia: "attendance:read",
  reunioes: "meetings:read",
  feedbacks: "feedbacks:read",
};

export default async function ReportsPage() {
  const actor = await requirePermission("reports:export");
  const kinds = REPORT_KINDS.filter((k) => can(actor, REQUIRED[k]));
  const [employees, { teams }, types] = await Promise.all([
    can(actor, "employees:read") ? employeeOptions(db, actor, { includeInactive: true }) : Promise.resolve([]),
    distinctTeamsAndTitles(db),
    can(actor, "attendance:read") ? listOccurrenceTypes(db, actor, { includeInactive: true }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Exportação"
        title="Relatórios"
        description="Arquivos gerados no servidor a partir dos dados do banco, respeitando filtros e permissões. Informações sensíveis ficam de fora por padrão; cada exportação é registrada na auditoria."
      />
      <Panel>
        <ReportForm
          kinds={kinds}
          employees={employees.map((e) => ({ value: e.value, label: e.label }))}
          categories={{
            semanal: teams.map((t) => ({ value: t, label: t })),
            metricas: teams.map((t) => ({ value: t, label: t })),
            frequencia: types.map((t) => ({ value: t.name, label: t.name })),
            reunioes: options(MEETING_TYPE),
            feedbacks: options(FEEDBACK_TYPE),
          }}
        />
      </Panel>
    </>
  );
}
