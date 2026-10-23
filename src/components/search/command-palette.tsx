"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleAlert, CornerDownLeft, LoaderCircle, Search, X } from "lucide-react";
import type { SearchResponse, SearchResult } from "@/modules/search/types";
import { Highlight } from "./highlight";

type Status = "idle" | "loading" | "done" | "error";

const DEBOUNCE_MS = 250;
const PLACEHOLDER = "Pesquisar colaboradores, reuniões, métricas, ocorrências...";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- detecção de plataforma só existe no navegador
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Pesquisa com debounce e cancelamento da requisição anterior
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia o estado ao limpar o termo
      setStatus("idle");
      setData(null);
      return;
    }
    setStatus("loading");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/pesquisa?q=${encodeURIComponent(q)}&limite=5`, { signal: controller.signal, headers: { accept: "application/json" } });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SearchResponse;
        setData(json);
        setActive(0);
        setStatus("done");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, router]);

  const flat: SearchResult[] = useMemo(() => data?.groups.flatMap((g) => g.items) ?? [], [data]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const go = useCallback(
    (url: string) => {
      setOpen(false);
      setQuery("");
      router.push(url);
    },
    [router],
  );

  const fullResultsUrl = `/pesquisa?q=${encodeURIComponent(query.trim())}`;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % (flat.length + 1) : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length + 1) % (flat.length + 1) : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active < flat.length && flat[active]) go(flat[active].url);
      else if (query.trim().length >= 2) go(fullResultsUrl);
    }
  }

  useEffect(() => {
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  let index = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full max-w-xl items-center gap-2.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-left text-[13.5px] text-subtle transition-colors hover:border-line-strong"
        aria-haspopup="dialog"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          <span className="hidden sm:inline">{PLACEHOLDER}</span>
          <span className="sm:hidden">Pesquisar…</span>
        </span>
        <span className="ml-auto hidden shrink-0 gap-1 sm:flex">
          <kbd className="kbd">{isMac ? "⌘" : "Ctrl"}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-6" role="presentation">
          <button type="button" aria-label="Fechar pesquisa" tabIndex={-1} className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={close} />
          <div role="dialog" aria-modal="true" aria-label="Pesquisa global" className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_24px_60px_-12px_rgba(18,18,18,0.25)]" onKeyDown={onKeyDown}>
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              {status === "loading" ? <LoaderCircle className="size-4 shrink-0 animate-spin text-subtle" aria-hidden /> : <Search className="size-4 shrink-0 text-subtle" aria-hidden />}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={PLACEHOLDER}
                className="w-full bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls={listId}
                aria-activedescendant={flat.length ? `${listId}-opt-${active}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                maxLength={100}
              />
              <button type="button" onClick={close} className="btn btn-ghost btn-sm" aria-label="Fechar">
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2" aria-live="polite">
              {status === "idle" ? (
                <div className="px-3 py-6 text-sm text-muted">
                  <p className="subheading mb-3 text-ink">Pesquisa global</p>
                  <p>Digite ao menos 2 caracteres. Você pode buscar nomes, títulos, palavras de pautas e identificadores como <span className="font-medium text-ink">COL-3</span> ou <span className="font-medium text-ink">OCO-12</span>.</p>
                </div>
              ) : null}
              {status === "loading" && !data ? <p className="px-3 py-6 text-sm text-muted">Pesquisando…</p> : null}
              {status === "error" ? (
                <p className="flex items-center gap-2 px-3 py-6 text-sm text-danger">
                  <CircleAlert className="size-4" aria-hidden /> Não foi possível pesquisar agora. Tente novamente.
                </p>
              ) : null}
              {status === "done" && data && data.total === 0 ? (
                <div className="px-3 py-6 text-sm text-muted">
                  <p className="subheading mb-2 text-ink">Nenhum resultado</p>
                  <p>Nada encontrado para “{data.query}”. Verifique a grafia ou tente um termo mais curto.</p>
                </div>
              ) : null}
              {data && data.total > 0 && status !== "error" ? (
                <ul id={listId} role="listbox" aria-label="Resultados">
                  {data.groups.map((g) => (
                    <li key={g.type} role="presentation" className="mb-2">
                      <p className="eyebrow px-3 pb-1.5 pt-2">{g.label}</p>
                      <ul role="group" aria-label={g.label}>
                        {g.items.map((r) => {
                          index++;
                          const i = index;
                          const selected = i === active;
                          return (
                            <li
                              key={`${r.type}-${r.id}`}
                              id={`${listId}-opt-${i}`}
                              role="option"
                              aria-selected={selected}
                              onMouseEnter={() => setActive(i)}
                              onClick={() => go(r.url)}
                              className={`flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5 ${selected ? "bg-primary-soft" : ""}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">
                                  <Highlight text={r.title} query={data.query} />
                                </p>
                                <p className="mt-0.5 truncate text-xs text-subtle">
                                  <Highlight text={r.summary} query={data.query} />
                                </p>
                              </div>
                              {r.date ? <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-subtle">{r.date}</span> : null}
                              {selected ? <CornerDownLeft className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-[11px] text-subtle">
              <span className="hidden gap-3 sm:flex">
                <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navegar</span>
                <span><kbd className="kbd">Enter</kbd> abrir</span>
                <span><kbd className="kbd">Esc</kbd> fechar</span>
              </span>
              {query.trim().length >= 2 ? (
                <button
                  type="button"
                  id={`${listId}-opt-${flat.length}`}
                  onClick={() => go(fullResultsUrl)}
                  onMouseEnter={() => setActive(flat.length)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium ${active === flat.length ? "bg-primary text-white" : "text-primary hover:bg-primary-soft"}`}
                >
                  Ver todos os resultados <ArrowRight className="size-3" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
