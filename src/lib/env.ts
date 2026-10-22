import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL não definida"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET deve ter pelo menos 32 caracteres"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  ATTACHMENTS_DIR: z.string().default("./storage/anexos"),
  // Diretório onde o script de backup grava os dumps (somente leitura pela aplicação)
  BACKUP_DIR: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Configuração de ambiente inválida: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function cookieSecure(): boolean {
  const e = env();
  if (e.COOKIE_SECURE) return e.COOKIE_SECURE === "true";
  return e.NODE_ENV === "production";
}
