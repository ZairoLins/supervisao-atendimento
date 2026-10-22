import type { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "./errors";

export const PERMISSIONS = [
  "employees:read",
  "employees:write",
  "attendance:read",
  "attendance:write",
  // Dados restritos de frequência (observações médicas e anexos)
  "attendance:restricted",
  "metrics:read",
  "metrics:write",
  "meetings:read",
  "meetings:write",
  "feedbacks:read",
  "feedbacks:write",
  "notes:read",
  "notes:write",
  "tasks:read",
  "tasks:write",
  "reports:export",
  "settings:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPERVISOR: PERMISSIONS,
  // Perfil auxiliar para uso futuro: sem acesso a frequência, feedbacks, anotações e auditoria.
  ASSISTANT: ["employees:read", "metrics:read", "meetings:read", "meetings:write", "tasks:read", "tasks:write"],
};

export type Actor = {
  id: string;
  name: string;
  username: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function makeActor(user: { id: string; name: string; username: string; role: Role }): Actor {
  return { id: user.id, name: user.name, username: user.username, role: user.role, permissions: permissionsFor(user.role) };
}

export function can(actor: Pick<Actor, "permissions">, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function assertCan(actor: Pick<Actor, "permissions">, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}
