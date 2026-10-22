import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { today } from "@/lib/page";
import { monthKey } from "@/lib/dates";
import { readParams } from "@/lib/validation";
import { employeeOptions } from "@/modules/employees/service";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { AttendanceNav } from "../nav";

export const metadata: Metadata = { title: "Escala" };

export default async function ScalePickerPage(props: PageProps<"/frequencia/escala">) {
  const actor = await requirePermission("attendance:read");
  const params = readParams(await props.searchParams);
  if (params.colaborador && /^[0-9a-f-]{36}$/.test(params.colaborador)) {
    redirect(`/frequencia/escala/${params.colaborador}${params.mes ? `?mes=${encodeURIComponent(params.mes)}` : ""}`);
  }
  const employees = await employeeOptions(db, actor);
  return (
    <>
      <PageHeader eyebrow="Frequência e escalas" title="Escala / calendário" description="Calendário mensal de turnos e folgas, com a escala prevista e a efetiva após trocas e ajustes." />
      <AttendanceNav active="escala" />
      <Panel className="max-w-2xl">
        {employees.length === 0 ? (
          <EmptyState title="Nenhum colaborador ativo" />
        ) : (
          <form method="get" className="flex flex-wrap items-end gap-4">
            <div className="min-w-64 flex-1">
              <label className="label" htmlFor="e-col">Colaborador</label>
              <select id="e-col" name="colaborador" required className="input">
                <option value="">Selecione…</option>
                {employees.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="e-mes">Mês</label>
              <input id="e-mes" type="month" name="mes" defaultValue={monthKey(today())} className="input" />
            </div>
            <button type="submit" className="btn btn-primary">Ver escala</button>
          </form>
        )}
      </Panel>
    </>
  );
}
