/**
 * Manutenção periódica: remove sessões expiradas e tentativas de login antigas.
 * Executada diariamente pelo timer do systemd (deploy/supervisao-backup.service).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { purgeExpiredSessions } from "../src/lib/auth/sessions";
import { purgeOldLoginAttempts } from "../src/lib/auth/login";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const sessions = await purgeExpiredSessions(db);
    const attempts = await purgeOldLoginAttempts(db, 30);
    console.log(`Manutenção concluída: ${sessions} sessão(ões) expirada(s) e ${attempts} tentativa(s) antiga(s) removidas.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Erro na manutenção: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
