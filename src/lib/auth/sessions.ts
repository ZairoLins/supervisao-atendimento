import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db";

/** Token opaco entregue ao navegador (256 bits de entropia). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda apenas o hash do token: um vazamento do banco não permite sequestrar sessões. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const HOUR_MS = 3_600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export type SessionUser = { id: string; name: string; username: string; role: "SUPERVISOR" | "ASSISTANT" };

export async function createSession(
  db: Db,
  userId: string,
  ttlHours: number,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * HOUR_MS);
  await db.session.create({
    data: { id: hashSessionToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

/**
 * Valida o token. Expiração deslizante: quando passa da metade da validade, renova.
 * Retorna o novo vencimento quando houve renovação (para reemitir o cookie).
 */
export async function validateSessionToken(
  db: Db,
  token: string,
  ttlHours: number,
  now: Date = new Date(),
): Promise<{ user: SessionUser; renewedExpiresAt: Date | null } | null> {
  if (!token || token.length > 200) return null;
  const id = hashSessionToken(token);
  const session = await db.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, username: true, role: true, active: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime() || !session.user.active) {
    await db.session.deleteMany({ where: { id } });
    return null;
  }
  let renewedExpiresAt: Date | null = null;
  const ttlMs = ttlHours * HOUR_MS;
  const data: { expiresAt?: Date; lastSeenAt?: Date } = {};
  if (session.expiresAt.getTime() - now.getTime() < ttlMs / 2) {
    renewedExpiresAt = new Date(now.getTime() + ttlMs);
    data.expiresAt = renewedExpiresAt;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) data.lastSeenAt = now;
  if (data.expiresAt || data.lastSeenAt) await db.session.update({ where: { id }, data });
  const { id: userId, name, username, role } = session.user;
  return { user: { id: userId, name, username, role }, renewedExpiresAt };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashSessionToken(token) } });
}

export async function invalidateUserSessions(db: Db, userId: string, exceptToken?: string): Promise<void> {
  await db.session.deleteMany({
    where: { userId, ...(exceptToken ? { NOT: { id: hashSessionToken(exceptToken) } } : {}) },
  });
}

export async function purgeExpiredSessions(db: Db): Promise<number> {
  const r = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}
