import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { makeActor, permissionsFor, type Actor, type Permission } from "@/lib/permissions";
import { hashPassword } from "@/lib/auth/password";
import { seedSystemData } from "../../prisma/seed";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

let client: PrismaClient | null = null;

export function testDb(): PrismaClient {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL não definida");
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
  return client;
}

/** Limpa todas as tabelas (exceto o histórico de migrações) e recarrega os dados de sistema. */
export async function resetDb(): Promise<void> {
  const db = testDb();
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, "")}"`).join(", ");
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await seedSystemData(db);
}

export async function createUser(role: "SUPERVISOR" | "ASSISTANT" = "SUPERVISOR", username = role.toLowerCase()): Promise<Actor> {
  const db = testDb();
  const u = await db.user.create({
    data: { username, name: `Usuário ${username}`, role, passwordHash: await hashPassword("SenhaDeTeste123") },
  });
  return makeActor(u);
}

/** Ator com permissões customizadas (para testar combinações específicas). */
export function withPermissions(base: Actor, perms: Permission[]): Actor {
  return { ...base, permissions: new Set(perms) };
}

export function allPermissions(): Set<Permission> {
  return new Set(permissionsFor("SUPERVISOR"));
}

export async function disconnect() {
  await client?.$disconnect();
  client = null;
}
