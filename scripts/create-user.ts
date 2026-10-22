/**
 * Cria (ou redefine a senha de) um usuário, pelo terminal do servidor.
 *
 *   npm run user:create -- --username supervisor --name "Nome do Supervisor"
 *   npm run user:create -- --username supervisor --reset      (redefine senha)
 *
 * A senha é digitada de forma oculta (nunca vai para argumentos, histórico ou logs).
 * Em automação, pode ser lida da variável NEW_USER_PASSWORD.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { checkPasswordPolicy, hashPassword } from "../src/lib/auth/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) out.output.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const username = arg("username")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const role = (arg("role") ?? "SUPERVISOR").toUpperCase();
  const reset = process.argv.includes("--reset");
  if (!username || !/^[a-z0-9._-]{3,60}$/.test(username)) {
    throw new Error("Informe --username (3 a 60 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado).");
  }
  if (role !== "SUPERVISOR" && role !== "ASSISTANT") throw new Error("--role deve ser SUPERVISOR ou ASSISTANT.");

  let password = process.env.NEW_USER_PASSWORD;
  if (!password) {
    password = await askHidden("Senha: ");
    const confirm = await askHidden("Confirme a senha: ");
    if (password !== confirm) throw new Error("As senhas não conferem.");
  }
  const policy = checkPasswordPolicy(password);
  if (policy) throw new Error(policy);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const passwordHash = await hashPassword(password);
    const existing = await db.user.findUnique({ where: { username } });
    if (existing && !reset) throw new Error("Usuário já existe. Use --reset para redefinir a senha.");
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { passwordHash, active: true } });
      await db.session.deleteMany({ where: { userId: existing.id } });
      await db.auditLog.create({ data: { userId: existing.id, action: "PASSWORD_RESET", entityType: "User", entityId: existing.id, summary: "Senha redefinida pelo terminal do servidor" } });
      console.log(`Senha de "${username}" redefinida. Sessões anteriores encerradas.`);
    } else {
      if (!name) throw new Error('Informe --name "Nome completo".');
      const u = await db.user.create({ data: { username, name, passwordHash, role: role as "SUPERVISOR" } });
      await db.auditLog.create({ data: { userId: u.id, action: "CREATE", entityType: "User", entityId: u.id, summary: `Usuário "${username}" criado pelo terminal do servidor` } });
      console.log(`Usuário "${username}" criado com perfil ${role}.`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Erro: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
