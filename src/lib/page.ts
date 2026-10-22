import "server-only";
import { forbidden, notFound } from "next/navigation";
import { env } from "./env";
import { todayInTimeZone } from "./dates";
import { AppError } from "./errors";

/** Converte erros de domínio em 404/403 nas páginas. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError && e.code === "FORBIDDEN") forbidden();
    throw e;
  }
}

/** Data de hoje no fuso da aplicação (data de calendário). */
export function today(): Date {
  return todayInTimeZone(env().APP_TIMEZONE);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function assertUuid(value: string): string {
  if (!isUuid(value)) notFound();
  return value;
}
