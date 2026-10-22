/**
 * Carga inicial de dados de sistema (idempotente): jornadas padrão e tipos de ocorrência.
 * NÃO cria usuários nem dados fictícios. Crie o usuário com `npm run user:create`.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_OCCURRENCE_TYPES, DEFAULT_SCHEDULES } from "../src/modules/attendance/rules";

export async function seedSystemData(db: PrismaClient) {
  for (const t of DEFAULT_OCCURRENCE_TYPES) {
    await db.occurrenceType.upsert({
      where: { code: t.code },
      create: { ...t, isSystem: true },
      update: { isSystem: true },
    });
  }
  for (const s of DEFAULT_SCHEDULES) {
    const exists = await db.workSchedule.findUnique({ where: { name: s.name } });
    if (exists) continue;
    await db.workSchedule.create({
      data: {
        name: s.name,
        description: s.description,
        kind: s.kind,
        weekdays: s.weekdays,
        cycleDays: s.cycleDays,
        workOffsets: s.workOffsets,
        segments: { create: s.segments.map((seg, i) => ({ position: i, ...seg })) },
      },
    });
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedSystemData(db);
    console.log("Dados de sistema carregados: tipos de ocorrência e jornadas padrão.");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
