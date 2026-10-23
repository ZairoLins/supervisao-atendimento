"use client";

import { useState } from "react";
import { FieldShell, useField } from "@/components/ui/form";

/**
 * Escolha do grupo: lista os grupos do número conectado; o nome escolhido vai junto
 * (campo oculto) para aparecer nas telas e no histórico.
 */
export function GroupPicker({
  groups,
  defaultJid,
  defaultName,
}: {
  groups: Array<{ id: string; subject: string; size: number | null }>;
  defaultJid: string | null;
  defaultName: string | null;
}) {
  const jid = useField("groupJid", defaultJid);
  const [value, setValue] = useState(jid.value);
  const [manual, setManual] = useState(groups.length === 0);
  const [typedName, setTypedName] = useState(defaultName ?? "Suporte Interno");
  const known = groups.find((g) => g.id === value);
  const name = manual ? typedName : (known?.subject ?? (value === defaultJid ? defaultName : null) ?? "");

  return (
    <FieldShell
      id={jid.id}
      label="Grupo do Suporte Interno"
      error={jid.error}
      hint={
        manual
          ? "Informe o identificador do grupo (termina em @g.us). Com o WhatsApp conectado, a lista de grupos aparece aqui."
          : "Grupos em que o número conectado participa."
      }
    >
      {manual ? (
        <div className="flex flex-col gap-2">
          <input id={jid.id} name="groupJid" className="input font-mono text-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder="120363000000000000@g.us" aria-invalid={jid.error ? true : undefined} />
          <input aria-label="Nome do grupo" className="input" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Nome do grupo (para exibição)" maxLength={120} />
        </div>
      ) : (
        <select id={jid.id} name="groupJid" className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={jid.error ? true : undefined}>
          <option value="">Nenhum</option>
          {value && !known ? <option value={value}>{defaultName ?? value}</option> : null}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.subject}
              {g.size ? ` (${g.size} participantes)` : ""}
            </option>
          ))}
        </select>
      )}
      <input type="hidden" name="groupName" value={name} />
      {groups.length > 0 ? (
        <button type="button" className="link mt-1.5 text-xs" onClick={() => setManual((m) => !m)}>
          {manual ? "Escolher da lista" : "Digitar o identificador"}
        </button>
      ) : null}
    </FieldShell>
  );
}
