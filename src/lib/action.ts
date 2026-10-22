import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAppError } from "./errors";
import { getCurrentActor } from "./auth/dal";
import type { Actor } from "./permissions";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Valores enviados, para repovoar o formulário após erro de validação. */
  values?: Record<string, string>;
  /** Incrementa a cada envio para remontar campos não controlados. */
  nonce?: number;
};

export const initialActionState: ActionState = { ok: false };

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v === "string") out[k] = out[k] !== undefined ? `${out[k]},${v}` : v;
  }
  return out;
}

/** Converte FormData em objeto: campos repetidos viram arrays; arquivos são ignorados. */
export function formToObject(formData: FormData, arrayFields: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = arrayFields.includes(key) ? all : all[all.length - 1];
  }
  for (const key of arrayFields) if (!(key in out)) out[key] = [];
  return out;
}

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

type Outcome = { message?: string; redirectTo?: string; revalidate?: string[] } | void;

/**
 * Executa uma Server Action com autenticação, tratamento seguro de erros e
 * revalidação. Erros inesperados nunca expõem detalhes internos ao usuário.
 */
export async function runAction(
  formData: FormData,
  fn: (actor: Actor) => Promise<Outcome>,
): Promise<ActionState> {
  const values = formValues(formData);
  const nonce = Date.now();
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");

  let outcome: Outcome;
  try {
    outcome = await fn(actor);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, message: "Revise os campos destacados.", fieldErrors: zodFieldErrors(e), values, nonce };
    }
    if (isAppError(e)) {
      return { ok: false, message: e.message, fieldErrors: e.fieldErrors, values, nonce };
    }
    // Registra apenas o tipo/código do erro: mensagens podem conter dados enviados.
    const code = (e as { code?: unknown })?.code;
    console.error("[action] erro inesperado:", e instanceof Error ? e.name : "desconhecido", code ?? "");
    return { ok: false, message: "Não foi possível concluir a operação. Tente novamente.", values, nonce };
  }

  for (const p of outcome?.revalidate ?? []) revalidatePath(p, "layout");
  if (outcome?.redirectTo) redirect(outcome.redirectTo);
  return { ok: true, message: outcome?.message ?? "Alterações salvas.", nonce };
}
