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
        className="block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-[22.5px] file:border file:border-cream/60 file:bg-transparent file:px-3 file:py-1.5 file:text-[11px] file:font-medium file:uppercase file:text-cream"
      />
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : hint ? <p className="mt-1.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
