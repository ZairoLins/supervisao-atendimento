import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "./db";

/** Campos que nunca podem aparecer em auditoria ou logs. */
const REDACTED_FIELDS = new Set(["passwordHash", "password", "restrictedNotes", "token", "searchText"]);

type Plain = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toFixed" in value && typeof (value as { toString: () => string }).toString === "function") {
    // Prisma.Decimal
    return (value as { toString: () => string }).toString();
  }
  return value;
}

export function redact(record: Plain | null | undefined): Plain | null {
  if (!record) return null;
  const out: Plain = {};
  for (const [k, v] of Object.entries(record)) {
    if (REDACTED_FIELDS.has(k)) {
      if (k === "restrictedNotes") out[k] = v ? "[restrito]" : null;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !("toFixed" in (v as object))) continue;
    out[k] = serialize(v);
  }
  return out;
}

/** Calcula as diferenças entre dois registros, já sem campos sensíveis. */
export function diff(before: Plain | null | undefined, after: Plain | null | undefined): Record<string, { from: unknown; to: unknown }> {
  const a = redact(before) ?? {};
  const b = redact(after) ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (k === "updatedAt" || k === "createdAt") continue;
    const from = a[k] ?? null;
    const to = b[k] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) out[k] = { from, to };
  }
  return out;
}

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Plain | null;
  after?: Plain | null;
  reason?: string | null;
};

export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  const changes = input.before || input.after ? diff(input.before, input.after) : null;
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      changes: changes && Object.keys(changes).length ? (changes as Prisma.InputJsonValue) : undefined,
      reason: input.reason ?? null,
    },
  });
}
