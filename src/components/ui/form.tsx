"use client";

import { createContext, Fragment, useActionState, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { ActionState } from "@/lib/action";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const FormStateContext = createContext<ActionState>({ ok: false });

export function useFormState(): ActionState {
  return useContext(FormStateContext);
}

/**
 * Formulário ligado a uma Server Action. Mostra mensagens de sucesso/erro, destaca
 * campos inválidos e preserva os valores digitados após erro de validação.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  encType,
  id,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  encType?: "multipart/form-data";
  id?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <FormStateContext value={state}>
      <form ref={ref} id={id} action={formAction} className={className} encType={encType} noValidate>
        <Fragment key={state.ok ? "ok" : (state.nonce ?? 0)}>{children}</Fragment>
      </form>
    </FormStateContext>
  );
}

export function FormMessage() {
  const state = useFormState();
  if (!state.message) return null;
  const Icon = state.ok ? CircleCheck : CircleAlert;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`flex items-start gap-2 text-sm ${state.ok ? "text-ok" : "text-danger"}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{state.message}</span>
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  className,
  name,
  value,
  confirm,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={`btn btn-${variant} ${className ?? ""}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function useField(name: string, defaultValue?: string | number | null) {
  const state = useFormState();
  const id = useId();
  const error = state.fieldErrors?.[name];
  const value = !state.ok && state.values && name in state.values ? state.values[name] : defaultValue ?? "";
  return { id, error, value: value === null ? "" : String(value) };
}

type BaseFieldProps = {
  name: string;
  label: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  disabled?: boolean;
};

export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required ? <span className="accent" aria-hidden> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  required,
  className,
  disabled,
  defaultValue,
  type = "text",
  placeholder,
  autoComplete,
  min,
  max,
  step,
  list,
  inputMode,
  maxLength,
}: BaseFieldProps & {
  defaultValue?: string | number | null;
  type?: "text" | "date" | "time" | "number" | "password" | "month" | "search";
  placeholder?: string;
  autoComplete?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  list?: string;
  inputMode?: "numeric" | "decimal" | "text";
  maxLength?: number;
}) {
  const f = useField(name, defaultValue);
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required} className={className}>
      <input
        id={f.id}
        name={name}
        type={type}
        defaultValue={type === "password" ? undefined : f.value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        list={list}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.error ? `${f.id}-err` : hint ? `${f.id}-hint` : undefined}
        className="input"
      />
    </FieldShell>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  required,
  className,
  disabled,
  defaultValue,
  rows = 4,
  placeholder,
  maxLength,
}: BaseFieldProps & { defaultValue?: string | null; rows?: number; placeholder?: string; maxLength?: number }) {
  const f = useField(name, defaultValue);
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required} className={className}>
      <textarea
        id={f.id}
        name={name}
        rows={rows}
        defaultValue={f.value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.error ? `${f.id}-err` : hint ? `${f.id}-hint` : undefined}
        className="input"
      />
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  hint,
  required,
  className,
  disabled,
  defaultValue,
  options,
  placeholder,
  onChange,
}: BaseFieldProps & {
  defaultValue?: string | null;
  options: Array<{ value: string; label: string; group?: string }>;
  placeholder?: string;
  onChange?: (value: string) => void;
}) {
  const f = useField(name, defaultValue);
  const groups = new Map<string, Array<{ value: string; label: string }>>();
  for (const o of options) {
    const g = o.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <FieldShell id={f.id} label={label} hint={hint} error={f.error} required={required} className={className}>
      <select
        id={f.id}
        name={name}
        defaultValue={f.value}
        required={required}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.error ? `${f.id}-err` : hint ? `${f.id}-hint` : undefined}
        className="input"
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {[...groups.entries()].map(([g, opts]) =>
          g ? (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
  value = "on",
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  value?: string;
  hint?: string;
}) {
  const state = useFormState();
  const id = useId();
  const checked = !state.ok && state.values ? Boolean(state.values[name]?.split(",").includes(value)) : defaultChecked;
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input id={id} type="checkbox" name={name} value={value} defaultChecked={checked} className="checkbox" />
        {label}
      </label>
      {hint ? <p className="mt-1 pl-6.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

/** Grupo de caixas de seleção (ex.: participantes, dias da semana). */
export function CheckboxGroup({
  name,
  label,
  options,
  defaultValues = [],
  columns = 2,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValues?: string[];
  columns?: 1 | 2 | 3 | 4 | 7;
}) {
  const state = useFormState();
  const selected = !state.ok && state.values ? (state.values[name]?.split(",") ?? []) : defaultValues;
  const error = state.fieldErrors?.[name];
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 7: "sm:grid-cols-7" }[columns];
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {options.length === 0 ? <p className="text-xs text-subtle">Nenhuma opção disponível.</p> : null}
      <div className={`grid grid-cols-2 gap-2 ${cols}`}>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="checkbox" />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </fieldset>
  );
}

export function Hidden({ name, value }: { name: string; value: string | number | null | undefined }) {
  return <input type="hidden" name={name} value={value ?? ""} />;
}
