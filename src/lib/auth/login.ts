import { createHmac } from "node:crypto";
import type { Db } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { hashPassword, verifyPassword } from "./password";
import type { SessionUser } from "./sessions";

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_USERNAME = 5;
export const MAX_FAILURES_PER_IP = 20;

const GENERIC_ERROR = "Usuário ou senha inválidos.";

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("senha-ficticia-para-tempo-constante-1");
  return dummyHash;
}

export async function checkRateLimit(
  db: Db,
  username: string,
  ipHash: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; retryAfterMinutes: number }> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000);
  const [byUser, byIp] = await Promise.all([
    db.loginAttempt.findMany({
      where: { username, success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.loginAttempt.count({ where: { ipHash, success: false, createdAt: { gte: since } } }),
  ]);
  if (byUser.length >= MAX_FAILURES_PER_USERNAME || byIp >= MAX_FAILURES_PER_IP) {
    const oldest = byUser[0]?.createdAt ?? since;
    const unlockAt = oldest.getTime() + LOGIN_WINDOW_MINUTES * 60_000;
    return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil((unlockAt - now.getTime()) / 60_000)) };
  }
  return { allowed: true, retryAfterMinutes: 0 };
}

/**
 * Autentica usuário e senha com limite de tentativas por usuário e por IP.
 * Mensagem de erro genérica para não revelar se o usuário existe.
 */
export async function authenticate(
  db: Db,
  input: { username: string; password: string; ipHash: string },
): Promise<SessionUser> {
  const username = input.username.trim().toLowerCase();
  const limit = await checkRateLimit(db, username, input.ipHash);
  if (!limit.allowed) {
    throw new AppError(
      `Muitas tentativas sem sucesso. Tente novamente em ${limit.retryAfterMinutes} min.`,
      "RATE_LIMITED",
    );
  }

  const user = await db.user.findUnique({ where: { username } });
  let ok = false;
  if (user && user.active) {
    ok = await verifyPassword(user.passwordHash, input.password);
  } else {
    // Mesmo custo de verificação quando o usuário não existe (evita enumeração por tempo)
    await verifyPassword(await getDummyHash(), input.password);
  }

  await db.loginAttempt.create({ data: { username, ipHash: input.ipHash, success: Boolean(ok) } });

  if (!ok || !user) {
    await audit(db, {
      actorId: user?.id ?? null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user?.id ?? null,
      summary: `Tentativa de login sem sucesso para "${username.slice(0, 60)}"`,
    });
    throw new AppError(GENERIC_ERROR, "UNAUTHENTICATED");
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(db, { actorId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, summary: "Login realizado" });
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export async function purgeOldLoginAttempts(db: Db, olderThanDays = 30): Promise<number> {
  const r = await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } } });
  return r.count;
}
