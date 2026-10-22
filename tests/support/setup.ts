import "dotenv/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Os testes nunca usam o banco de desenvolvimento/produção.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}
process.env.SESSION_SECRET ??= "segredo-de-teste-com-mais-de-32-caracteres";

// Anexos dos testes em diretório temporário isolado
process.env.ATTACHMENTS_DIR = mkdtempSync(join(tmpdir(), "sv-anexos-"));
