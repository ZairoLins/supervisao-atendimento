/** Identifica violação de unicidade (P2002) sem depender da classe concreta do erro. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** Violação de chave estrangeira (P2003) — ex.: registro relacionado inexistente. */
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003";
}
