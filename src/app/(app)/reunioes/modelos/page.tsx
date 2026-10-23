import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { formatDate, formatTimeRange, toDateKey } from "@/lib/dates";
import { MEETING_TYPE, WEEKDAYS, options } from "@/lib/labels";
import { listSeries, listTemplates } from "@/modules/meetings/service";
import { employeeOptions } from "@/modules/employees/service";
import { createSeriesAction, createTemplateAction, deleteTemplateAction, generateSeriesAction, toggleSeriesAction } from "@/modules/meetings/actions";
import { ActionForm, CheckboxGroup, FormMessage, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { Badge, LabelBadge, PageHeader, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Modelos e recorrência" };

export default async function TemplatesPage() {
  const actor = await requirePermission("meetings:write");
  const [templates, series, employees] = await Promise.all([
    listTemplates(db, actor),
    listSeries(db, actor),
    can(actor, "employees:read") ? employeeOptions(db, actor) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader eyebrow="Reuniões" title="Modelos e recorrência" description="Modelos de pauta reutilizáveis e reuniões semanais recorrentes. Cada reunião gerada é independente e pode ser ajustada." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Panel title="Reuniões semanais recorrentes">
            {series.length === 0 ? <p className="mb-2 text-sm text-muted">Nenhuma série configurada.</p> : (
              <ul className="flex flex-col">
                {series.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-4 first:pt-0 last:border-0">
                    <div>
                      <p>{s.title} {s.active ? null : <Badge tone="neutral">Pausada</Badge>}</p>
                      <p className="mt-1 text-xs text-subtle">
                        {WEEKDAYS[s.weekday]} · {formatTimeRange(s.startMinute, s.endMinute)} · desde {formatDate(s.startDate)}{s.endDate ? ` até ${formatDate(s.endDate)}` : ""} · {s._count.meetings} reunião(ões){s.template ? ` · modelo “${s.template.name}”` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {s.active ? (
                        <ActionForm action={generateSeriesAction.bind(null, s.id)}>
                          <SubmitButton variant="secondary" className="btn-sm">Gerar próximas 4</SubmitButton>
                        </ActionForm>
                      ) : null}
                      <ActionForm action={toggleSeriesAction.bind(null, s.id)}>
                        <SubmitButton variant="ghost" className="btn-sm">{s.active ? "Pausar" : "Retomar"}</SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Nova série semanal">
            <ActionForm action={createSeriesAction} resetOnSuccess className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextField name="title" label="Título" required defaultValue="Reunião semanal da equipe" className="sm:col-span-2" maxLength={160} />
              <SelectField name="weekday" label="Dia da semana" options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} defaultValue="1" />
              <div className="grid grid-cols-2 gap-4">
                <TextField name="startTime" label="Início" type="time" required defaultValue="09:00" />
                <TextField name="endTime" label="Término" type="time" required defaultValue="10:00" />
              </div>
              <TextField name="startDate" label="A partir de" type="date" required defaultValue={toDateKey(today())} />
              <TextField name="endDate" label="Até (opcional)" type="date" />
              <SelectField name="templateId" label="Modelo de pauta" options={templates.map((t) => ({ value: t.id, label: t.name }))} placeholder="Sem modelo" />
              <TextField name="weeksAhead" label="Semanas a gerar agora" type="number" min={1} max={26} defaultValue={8} required />
              <div className="sm:col-span-2"><CheckboxGroup name="participantIds" label="Participantes" options={employees} columns={2} /></div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><SubmitButton>Criar série</SubmitButton><FormMessage /></div>
            </ActionForm>
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title="Modelos de pauta">
            {templates.length === 0 ? <p className="text-sm text-muted">Nenhum modelo. Crie abaixo ou salve a pauta de uma reunião existente.</p> : (
              <ul className="flex flex-col">
                {templates.map((t) => (
                  <li key={t.id} className="border-b border-line py-4 first:pt-0 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2">{t.name} <LabelBadge map={MEETING_TYPE} value={t.type} /></p>
                      <ActionForm action={deleteTemplateAction.bind(null, t.id)}>
                        <SubmitButton variant="ghost" className="btn-sm" confirm="Remover este modelo? Séries que o usam ficam sem modelo.">Remover</SubmitButton>
                      </ActionForm>
                    </div>
                    <ol className="mt-2 list-inside list-decimal text-xs text-muted">
                      {t.agendaItems.map((a, i) => <li key={i}>{a}</li>)}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Novo modelo">
            <ActionForm action={createTemplateAction} resetOnSuccess className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextField name="name" label="Nome" required className="sm:col-span-2" maxLength={120} />
              <SelectField name="type" label="Tipo" options={options(MEETING_TYPE)} defaultValue="WEEKLY" />
              <TextField name="durationMinutes" label="Duração (min)" type="number" min={5} max={600} defaultValue={60} required />
              <TextAreaField name="agenda" label="Itens da pauta (um por linha)" rows={6} className="sm:col-span-2" />
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><SubmitButton>Criar modelo</SubmitButton><FormMessage /></div>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
