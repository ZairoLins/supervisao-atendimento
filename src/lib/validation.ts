import { z } from "zod";
import { isValidDateKey, isValidTime, parseDateKey, parseMonthKey } from "./dates";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const trim = (v: unknown) => (typeof v === "string" ? v.trim() : v);

export const requiredText = (label: string, max = 200) =>
  z.preprocess(trim, z.string({ error: `Informe ${label}.` }).min(1, `Informe ${label}.`).max(max, `Máximo de ${max} caracteres.`));

export const optionalText = (max = 5000) =>
  z.preprocess((v) => emptyToUndefined(trim(v)), z.string().max(max, `Máximo de ${max} caracteres.`).optional());

export const dateField = (label = "a data") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string({ error: `Informe ${label}.` })
      .refine(isValidDateKey, "Data inválida.")
      .transform((v) => parseDateKey(v)),
  );

export const optionalDateField = () =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine(isValidDateKey, "Data inválida.")
      .transform((v) => parseDateKey(v))
      .optional(),
  );

export const monthField = () =>
  z.preprocess(
    emptyToUndefined,
    z
      .string({ error: "Informe o mês de referência." })
      .regex(/^\d{4}-\d{2}$/, "Mês inválido.")
      .transform((v) => parseMonthKey(v)),
  );

export const timeField = (label = "o horário") =>
  z.preprocess(emptyToUndefined, z.string({ error: `Informe ${label}.` }).refine(isValidTime, "Horário inválido (HH:MM)."));

export const optionalTimeField = () => z.preprocess(emptyToUndefined, z.string().refine(isValidTime, "Horário inválido (HH:MM).").optional());

export const uuidField = (label = "o registro") =>
  z.preprocess(emptyToUndefined, z.string({ error: `Selecione ${label}.` }).uuid(`Selecione ${label}.`));

export const optionalUuid = () => z.preprocess(emptyToUndefined, z.string().uuid("Seleção inválida.").optional());

export const checkbox = () => z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const intField = (label: string, min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(",", "."))) : v),
    z
      .number({ error: `Informe ${label}.` })
      .int(`${label[0].toUpperCase()}${label.slice(1)} deve ser um número inteiro.`)
      .min(min, `Valor mínimo: ${min}.`)
      .max(max, `Valor máximo: ${max}.`),
  );

export const decimalField = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(",", "."))) : v),
    z
      .number({ error: `Informe ${label}.` })
      .refine((n) => Number.isFinite(n), "Número inválido.")
      .refine((n) => n >= min && n <= max, `Informe um valor entre ${min} e ${max}.`)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use no máximo duas casas decimais."),
  );

/** Parâmetros de listagem (página, ordenação e pesquisa) lidos de searchParams. */
export type ListParams = Record<string, string | undefined>;

export function readParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const out: ListParams = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

export function pageParam(params: ListParams): number {
  const n = Number(params.page);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : 1;
}

export function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export function safeDateParam(value: string | undefined): Date | undefined {
  return value && isValidDateKey(value) ? parseDateKey(value) : undefined;
}

export const PAGE_SIZE = 20;
