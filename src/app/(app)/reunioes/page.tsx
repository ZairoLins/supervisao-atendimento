import type { Metadata } from "next";
import Link from "next/link";
import { LayoutTemplate, Plus, UsersRound } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { today } from "@/lib/page";
import { formatDate, formatTime, formatWeekday, toDateKey } from "@/lib/dates";
import { MEETING_STATUS, MEETING_TYPE } from "@/lib/labels";
import { formatCode } from "@/lib/text";
import { pageParam, pickEnum, readParams, safeDateParam } from "@/lib/validation";
import { listMeetings } from "@/modules/meetings/service";
import { EmptyState, LabelBadge, PageHeader, Pagination, Panel, Tabs } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reuniões" };

export default async function MeetingsPage(props: PageProps<"/reunioes">) {
  const actor = await requirePermission("meetings:read");
  const params = readParams(await props.searchParams);
  const when = pickEnum(params.quando, ["upcoming", "past", "all"] as const) ?? "upcoming";
  const type = pickEnum(params.tipo, ["WEEKLY", "EXTRAORDINARY"] as const);
  const status = pickEnum(params.status, ["SCHEDULED", "DONE", "CANCELED"] as const);
  const from = safeDateParam(params.de);
  const to = safeDateParam(params.ate);
  const t = today();
  const result = await listMeetings(db, actor, { q: params.q, type, status, from, to, when: when === "all" ? undefined : when, page: pageParam(params) }, t);
  const filtered = Boolean(params.q || type || status || from || to);
  const base = (q: string) => `/reunioes?quando=${q}`;

  return (
    <>
      <PageHeader
        eyebrow="Rotina da equipe"
        title="Reuniões"
        description="Pautas planejadas, anotações da reunião e ações definidas — cada parte registrada separadamente."
        actions={
          can(actor, "meetings:write") ? (
            <>
              <Link href="/reunioes/modelos" className="btn btn-secondary"><LayoutTemplate className="size-3.5" aria-hidden /> Modelos e recorrência</Link>
              <Link href="/reunioes/nova" className="btn btn-primary"><Plus className="size-3.5" aria-hidden /> Nova reunião</Link>
            </>
          ) : null
        }
      />
      <Tabs
        active={when}
        items={[
          { key: "upcoming", label: "Próximas", href: base("upcoming") },
          { key: "past", label: "Anteriores", href: base("past") },
          { key: "all", label: "Todas", href: base("all") },
        ]}
      />
      <Panel>
        <form method="get" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
          <input type="hidden" name="quando" value={when} />
          <div><label className="label" htmlFor="m-q">Título, assunto ou pauta</label><input id="m-q" name="q" defaultValue={params.q} className="input" placeholder="Ex.: escala de fim de ano" /></div>
          <div>
            <label className="label" htmlFor="m-tipo">Tipo</label>
            <select id="m-tipo" name="tipo" defaultValue={type ?? ""} className="input"><option value="">Todos</option>{Object.entries(MEETING_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div>
            <label className="label" htmlFor="m-st">Situação</label>
            <select id="m-st" name="status" defaultValue={status ?? ""} className="input"><option value="">Todas</option>{Object.entries(MEETING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="m-de">De</label><input id="m-de" type="date" name="de" defaultValue={from ? toDateKey(from) : ""} className="input" /></div>
          <div><label className="label" htmlFor="m-ate">Até</label><input id="m-ate" type="date" name="ate" defaultValue={to ? toDateKey(to) : ""} className="input" /></div>
          <div className="flex gap-2"><button className="btn btn-secondary" type="submit">Filtrar</button>{filtered ? <Link href={base(when)} className="btn btn-ghost">Limpar</Link> : null}</div>
        </form>
        {result.total === 0 ? (
          filtered ? (
            <EmptyState title="Nenhuma reunião encontrada" description="Ajuste os filtros ou o período." />
          ) : (
            <EmptyState
              icon={<UsersRound className="size-6" />}
              title={when === "upcoming" ? "Nenhuma reunião agendada" : "Nenhuma reunião registrada"}
              description="Crie reuniões extraordinárias ou configure a reunião semanal recorrente."
              action={can(actor, "meetings:write") ? <Link href="/reunioes/nova" className="btn btn-primary">Criar reunião</Link> : null}
            />
          )
        ) : (
          <>
            <ul className="flex flex-col">
              {result.items.map((m) => (
                <li key={m.id} className="grid grid-cols-[72px_1fr] gap-4 border-b border-dashed border-cork py-4 first:pt-0 last:border-0 sm:grid-cols-[90px_1fr_auto]">
                  <div className="text-center">
                    <p className="eyebrow">{formatWeekday(m.date)}</p>
                    <p className="text-2xl font-medium tabular-nums leading-tight">{String(m.date.getUTCDate()).padStart(2, "0")}</p>
                    <p className="text-[11px] text-subtle">{formatDate(m.date).slice(3)}</p>
                  </div>
                  <div className="min-w-0">
                    <Link href={`/reunioes/${m.id}`} className="link">{m.title}</Link>
                    <p className="mt-1 text-xs text-subtle">
                      {formatCode("meeting", m.code)} · {formatTime(m.startMinute)}{m.endMinute ? `–${formatTime(m.endMinute)}` : ""} · {m._count.agendaItems} item(ns) de pauta · {m._count.participants} participante(s) · {m._count.tasks} ação(ões)
                    </p>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
                    <LabelBadge map={MEETING_TYPE} value={m.type} />
                    <LabelBadge map={MEETING_STATUS} value={m.status} />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination base="/reunioes" params={params} page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </Panel>
    </>
  );
}
