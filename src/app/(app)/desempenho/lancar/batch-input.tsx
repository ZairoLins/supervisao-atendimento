"use client";

import { useFormState } from "@/components/ui/form";

/** Campo compacto da tabela de lançamento do dia, com erro por célula. */
export function BatchInput({
  name,
  label,
  defaultValue,
  step,
  min,
  max,
  type = "number",
  placeholder,
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  step?: string;
  min?: number;
  max?: number;
  type?: "number" | "text";
  placeholder?: string;
  className?: string;
}) {
  const state = useFormState();
  const error = state.fieldErrors?.[name];
  const value = !state.ok && state.values && name in state.values ? state.values[name] : (defaultValue ?? "");
  return (
    <div className={className}>
      <input
        name={name}
        type={type}
        aria-label={label}
        defaultValue={value === null ? "" : String(value)}
        step={step}
        min={min}
        max={max}
        inputMode={type === "number" ? "decimal" : undefined}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        title={error}
        className="input px-2.5 py-1.5 tabular-nums"
      />
      {error ? <p className="mt-1 text-[11px] leading-tight text-danger">{error}</p> : null}
    </div>
  );
}
