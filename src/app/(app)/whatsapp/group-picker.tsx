"use client";

import { useState, useTransition } from "react";
import { CircleAlert, Plus, RefreshCw, X } from "lucide-react";
import { refreshGroupsAction } from "@/modules/whatsapp/actions";
import { useFormState } from "@/components/ui/form";
import { cx } from "@/components/ui/primitives";

type Group = { id: string; subject: string; size: number | null };

/**
 * Escolha dos grupos que recebem os avisos (até `max`). A lista vem dos grupos do número
 * conectado e pode ser atualizada; grupos já salvos continuam na lista mesmo se não vierem.
 * Cada marcação envia "jid|nome", para o nome aparecer nas telas e no histórico.
 */
export function GroupPicker({
  groups: initialGroups,
  selected: initialSelected,
  max,
  connected,
}: {
  groups: Group[];
  selected: Array<{ jid: string; name: string }>;
  max: number;
  connected: boolean;
}) {
  const state = useFormState();
  const error = state.fieldErrors?.groups;
  const [groups, setGroups] = useState<Group[]>(() => {
    const known = new Map(initialGroups.map((g) => [g.id, g]));
    for (const s of initialSelected) if (!known.has(s.jid)) known.set(s.jid, { id: s.jid, subject: s.name, size: null });
    return [...known.values()];
  });
  const [selected, setSelected] = useState<string[]>(() => initialSelected.map((s) => s.jid));
  const [filter, setFilter] = useState("");
  const [manualJid, setManualJid] = useState("");
  const [manualName, setManualName] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    setNotice(null);
    startTransition(async () => {
      const r = await refreshGroupsAction();
      if (!r.ok) {
        setNotice({ tone: "danger", text: r.message });
        return;
      }
      setGroups((prev) => {
        const map = new Map(r.groups.map((g) => [g.id, g]));
        // Grupos marcados que não vieram (ex.: o número saiu do grupo) continuam visíveis
        for (const g of prev) if (selected.includes(g.id) && !map.has(g.id)) map.set(g.id, g);
        return [...map.values()];
      });
      setNotice({ tone: "ok", text: `${r.groups.length} grupo(s) encontrado(s).` });
    });
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= max ? prev : [...prev, id]));
  }

  function addManual() {
    const jid = manualJid.trim();
    if (!/^[0-9]{5,30}(-[0-9]+)?@g\.us$/.test(jid)) {
      setNotice({ tone: "danger", text: "Identificador inválido: deve terminar em @g.us." });
      return;
    }
    setGroups((prev) => (prev.some((g) => g.id === jid) ? prev : [...prev, { id: jid, subject: manualName.trim() || "Grupo", size: null }]));
    setSelected((prev) => (prev.includes(jid) || prev.length >= max ? prev : [...prev, jid]));
    setManualJid("");
    setManualName("");
    setNotice(null);
  }

  const q = filter.trim().toLowerCase();
  const visible = groups
    .filter((g) => !q || g.subject.toLowerCase().includes(q) || selected.includes(g.id))
    .sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || a.subject.localeCompare(b.subject, "pt-BR"));
  const byId = new Map(groups.map((g) => [g.id, g]));

  return (
    <fieldset className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <legend className="label mb-0">
          Grupos que recebem os avisos <span className="font-normal text-subtle">· até {max}</span>
        </legend>
        <button type="button" onClick={refresh} disabled={pending || !connected} className="btn btn-secondary btn-sm" title={connected ? "Buscar os grupos do número conectado" : "Conecte o WhatsApp primeiro"}>
          <RefreshCw className={cx("size-3.5", pending && "animate-spin")} aria-hidden /> {pending ? "Atualizando…" : "Atualizar lista"}
        </button>
      </div>

      {selected.map((id) => (
        <input key={id} type="hidden" name="groups" value={`${id}|${byId.get(id)?.subject ?? "Grupo"}`} />
      ))}

      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Grupos escolhidos">
          {selected.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-ink py-1 pr-1.5 pl-3 text-[12.5px] text-white">
              {byId.get(id)?.subject ?? id}
              <button type="button" onClick={() => toggle(id)} className="grid size-5 place-items-center rounded-full hover:bg-white/15" aria-label={`Remover ${byId.get(id)?.subject ?? "grupo"}`}>
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle">Nenhum grupo escolhido.</p>
      )}

      {groups.length > 6 ? (
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar grupos…" className="input" aria-label="Filtrar grupos" />
      ) : null}

      {groups.length ? (
        <ul className="max-h-64 overflow-y-auto rounded-[8px] border border-line">
          {visible.map((g) => {
            const checked = selected.includes(g.id);
            const disabled = !checked && selected.length >= max;
            return (
              <li key={g.id} className="border-b border-line last:border-0">
                <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", checked ? "bg-canvas" : "hover:bg-canvas", disabled && "cursor-not-allowed opacity-50")}>
                  <input type="checkbox" className="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(g.id)} />
                  <span className="min-w-0 flex-1 truncate">{g.subject}</span>
                  {g.size ? <span className="font-mono text-[11px] text-subtle">{g.size} pessoas</span> : null}
                </label>
              </li>
            );
          })}
          {!visible.length ? <li className="px-3 py-3 text-xs text-subtle">Nenhum grupo com esse nome.</li> : null}
        </ul>
      ) : (
        <p className="rounded-[8px] border border-dashed border-line-strong px-3 py-4 text-xs text-subtle">
          {connected ? "Clique em “Atualizar lista” para buscar os grupos do número conectado." : "Conecte o WhatsApp para listar os grupos, ou informe o identificador abaixo."}
        </p>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-subtle hover:text-ink">Adicionar pelo identificador do grupo</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={manualJid} onChange={(e) => setManualJid(e.target.value)} placeholder="120363000000000000@g.us" className="input font-mono text-xs" aria-label="Identificador do grupo" />
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Nome do grupo" className="input" aria-label="Nome do grupo" maxLength={120} />
          <button type="button" onClick={addManual} className="btn btn-secondary btn-sm self-center">
            <Plus className="size-3.5" aria-hidden /> Adicionar
          </button>
        </div>
      </details>

      {notice ? (
        <p role={notice.tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-1.5 text-xs", notice.tone === "danger" ? "text-danger" : "text-ok")}>
          {notice.tone === "danger" ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null} {notice.text}
        </p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </fieldset>
  );
}
