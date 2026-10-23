"use client";

import { useId } from "react";
import { useFormState } from "./form";

export function FileField({ name, label, hint }: { name: string; label: string; hint?: string }) {
  const id = useId();
  const error = useFormState().fieldErrors?.[name];
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        name={name}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        aria-invalid={error ? true : undefined}
        className="block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink hover:file:bg-surface-2"
      />
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : hint ? <p className="mt-1.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
