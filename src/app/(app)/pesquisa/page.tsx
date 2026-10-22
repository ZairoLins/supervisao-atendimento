import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/dal";
import { toDateKey } from "@/lib/dates";
import { pickEnum, readParams, safeDateParam } from "@/lib/validation";
import { globalSearch, MIN_QUERY_LENGTH, searchableTypes } from "@/modules/search/service";
import { SEARCH_TYPE_LABEL, SEARCH_TYPES } from "@/modules/search/types";
import { EmptyState, PageHeader, Panel, buildHref } from "@/components/ui/primitives";
import { Highlight } from "@/components/search/highlight";

export const metadata: Metadata = { title: "Pesquisa" };

export default async function SearchPage(props: PageProps<"/pesquisa">) {
  const actor = await requireActor();
  const params = readParams(await props.searchParams);
  const q = (params.q ?? "").slice(0, 100);
  const type = pickEnum(params.tipo, SEARCH_TYPES);
  const from = safeDateParam(params.de);
  const to = safeDateParam(params.ate);
  const allowed = searchableTypes(actor);
  const result = q.trim() ? await globalSearch(db, actor, q, { limit: type ? 50 : 10, types: type ? [type] : undefined, from, to }) : null;

  return (
    <>
      <PageHeader eyebrow="Pesquisa global" title="Resultados" description="Pesquisa em todos os módulos que seu perfil pode acessar. Conteúdo restrito (dados médicos, anexos) nunca é pesquisado." />
      <Panel>
        <form method="get" role="search" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <label className="label" htmlFor="s-q">Termo</label>
            <input id="s-q" name="q" defaultValue={q} className="input" placeholder="Pesquisar colaboradores, reuniões, métricas, tarefas..." autoFocus maxLength={100} />
          </div>
          <div>
            <label className="label" htmlFor="s-tipo">Categoria</label>
            <select id="s-tipo" name="tipo" defaultValue={type ?? ""} className="input">
              <option value="">Todas</option>
              {allowed.map((t) => <option key={t} value={t}>{SEARCH_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="s-de">De</label><input id="s-de" type="date" name="de" defaultValue={from ? toDateKey(from) : ""} className="input" /></div>
          <div><label className="label" htmlFor="s-ate">Até</label><input id="s-ate" type="date" name="ate" defaultValue={to ? toDateKey(to) : ""} className="input" /></div>
          <button type="submit" className="btn btn-primary"><Search className="size-3.5" aria-hidden /> Pesquisar</button>
        </form>

        {!result ? (
          <EmptyState title="Digite um termo" description="Busque por nomes, títulos, palavras de pautas, meses (ex.: 10/2026) ou identificadores (COL-1, REU-3, TAR-12, OCO-5, FDB-2)." />
        ) : q.trim().length < MIN_QUERY_LENGTH && result.total === 0 ? (
          <EmptyState title="Termo muito curto" description={`Use ao menos ${MIN_QUERY_LENGTH} caracteres.`} />
        ) : result.total === 0 ? (
          <EmptyState title="Nenhum resultado" description={`Nada encontrado para “${result.query}”${type ? ` em ${SEARCH_TYPE_LABEL[type]}` : ""}${from || to ? " no período" : ""}.`} />
        ) : (
          <div className="flex flex-col gap-8">
            <p className="text-xs text-subtle">{result.total} resultado(s) exibido(s){from || to ? " · filtro de período aplicado onde há data" : ""}</p>
            {result.groups.map((g) => (
              <section key={g.type} aria-labelledby={`g-${g.type}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id={`g-${g.type}`} className="subheading">{g.label}</h2>
                  {g.hasMore && !type ? (
                    <Link className="link text-xs uppercase" href={buildHref("/pesquisa", params, { tipo: g.type })}>Ver mais em {g.label.toLowerCase()}</Link>
                  ) : null}
                </div>
                <ul className="flex flex-col">
                  {g.items.map((r) => (
                    <li key={`${r.type}-${r.id}`} className="flex items-start justify-between gap-4 border-b border-dashed border-cork py-3 last:border-0">
                      <div className="min-w-0">
                        <Link href={r.url} className="link"><Highlight text={r.title} query={result.query} /></Link>
                        <p className="mt-1 text-xs text-subtle"><Highlight text={r.summary} query={result.query} /></p>
                      </div>
                      {r.date ? <span className="shrink-0 text-xs tabular-nums text-subtle">{r.date}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
