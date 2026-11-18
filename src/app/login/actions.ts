"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { authenticate, hashIp } from "@/lib/auth/login";
import { endSession, getClientIp, rememberUsername, startSession } from "@/lib/auth/dal";
import type { ActionState } from "@/lib/action";

const schema = z.object({
  username: z.string().trim().min(1, "Informe o usuário.").max(60),
  password: z.string().min(1, "Informe a senha.").max(256),
});

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  const values = { username: String(formData.get("username") ?? "") };
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Preencha usuário e senha.", fieldErrors, values, nonce: Date.now() };
  }
  try {
    const ipHash = hashIp(await getClientIp(), env().SESSION_SECRET);
    const user = await authenticate(db, { ...parsed.data, ipHash });
    await startSession(user.id, formData.get("remember") === "on");
    await rememberUsername(formData.get("rememberUser") === "on" ? user.username : null);
  } catch (e) {
    if (isAppError(e)) return { ok: false, message: e.message, values, nonce: Date.now() };
    console.error("[login] erro inesperado", e instanceof Error ? e.name : "");
    return { ok: false, message: "Não foi possível entrar agora. Tente novamente.", values, nonce: Date.now() };
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  // A tela de login mostra o usuário lembrado: não reaproveitar a versão em cache
  revalidatePath("/login");
  redirect("/login");
}
