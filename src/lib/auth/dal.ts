import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { db } from "../db";
import { cookieSecure, env } from "../env";
import { makeActor, can, type Actor, type Permission } from "../permissions";
import { createSession, invalidateSession, validateSessionToken } from "./sessions";

export const SESSION_COOKIE = "sv_session";

/**
 * Cookie de sessão do navegador (sem data de expiração): some ao fechar o navegador.
 * A validade real (deslizante) é controlada no banco.
 */
async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
  });
}

export async function startSession(userId: string): Promise<void> {
  const ua = (await headers()).get("user-agent");
  const { token } = await createSession(db, userId, env().SESSION_TTL_HOURS, ua);
  await setSessionCookie(token);
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(db, token);
  store.delete(SESSION_COOKIE);
}

/** Lê e valida a sessão uma vez por requisição. */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await validateSessionToken(db, token, env().SESSION_TTL_HOURS);
  if (!result) return null;
  return makeActor(result.user);
});

/** Exige usuário autenticado (páginas). Redireciona para o login caso contrário. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Exige permissão (páginas). Usuário sem permissão vê a página 403. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, permission)) forbidden();
  return actor;
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  // Atrás de proxy reverso confiável (nginx), o primeiro IP de X-Forwarded-For é o cliente.
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") ?? "desconhecido";
}
