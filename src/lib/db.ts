import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

function createClient(url: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { __db?: PrismaClient };

function getUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  return url;
}

/** Cliente único por processo (reaproveitado entre recarregamentos em desenvolvimento). */
export const db: PrismaClient = globalForDb.__db ?? createClient(getUrl());

if (process.env.NODE_ENV !== "production") globalForDb.__db = db;
