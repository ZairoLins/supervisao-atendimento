import { z } from "zod";
import type { Db } from "../db";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import type { Actor } from "../permissions";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password";
import { hashSessionToken } from "./sessions";

const schema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual.").max(256),
  newPassword: z.string().min(1, "Informe a nova senha.").max(256),
  confirmPassword: z.string().max(256),
});

/** Troca a senha e encerra as demais sessões do usuário. */
export async function changePassword(db: Db, actor: Actor, raw: unknown, currentToken?: string) {
  const v = schema.parse(raw);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, v.currentPassword))) {
    throw new ValidationError("Senha atual incorreta.", { currentPassword: "Senha incorreta." });
  }
  const policy = checkPasswordPolicy(v.newPassword);
  if (policy) throw new ValidationError(policy, { newPassword: policy });
  if (v.newPassword !== v.confirmPassword) throw new ValidationError("A confirmação não confere.", { confirmPassword: "Diferente da nova senha." });
  if (v.newPassword === v.currentPassword) throw new ValidationError("A nova senha deve ser diferente da atual.", { newPassword: "Use uma senha diferente." });
  await db.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(v.newPassword) } });
  await db.session.deleteMany({
    where: { userId: actor.id, ...(currentToken ? { NOT: { id: hashSessionToken(currentToken) } } : {}) },
  });
  await audit(db, { actorId: actor.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: actor.id, summary: "Senha alterada; outras sessões encerradas" });
}

export async function listSessions(db: Db, actor: Actor) {
  return db.session.findMany({
    where: { userId: actor.id, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, expiresAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function revokeOtherSessions(db: Db, actor: Actor, currentToken: string) {
  const r = await db.session.deleteMany({ where: { userId: actor.id, NOT: { id: hashSessionToken(currentToken) } } });
  await audit(db, { actorId: actor.id, action: "SESSIONS_REVOKE", entityType: "User", entityId: actor.id, summary: `${r.count} sessão(ões) encerrada(s)` });
  return r.count;
}
