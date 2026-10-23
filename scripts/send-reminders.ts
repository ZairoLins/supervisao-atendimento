/**
 * Aviso automático das reuniões semanais no grupo do WhatsApp.
 * Executado a cada 10 minutos pelo timer do systemd (deploy/supervisao-avisos.timer).
 * Sem configuração da Evolution API ou com o aviso desativado, termina sem enviar nada.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { evolutionConfigFromEnv, evolutionSender } from "../src/modules/whatsapp/client";
import { runAutomaticReminders } from "../src/modules/whatsapp/core";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const cfg = evolutionConfigFromEnv();
  if (!cfg) {
    console.log("WhatsApp não configurado: nenhum aviso enviado.");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const r = await runAutomaticReminders(db, evolutionSender(cfg));
    if (r.skipped) console.log("Aviso automático desativado.");
    else if (r.sent || r.failed) console.log(`Avisos: ${r.sent} enviado(s), ${r.failed} com falha.`);
    if (r.failed) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Erro nos avisos: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
