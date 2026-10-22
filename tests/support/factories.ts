import type { Actor } from "@/lib/permissions";
import { createEmployee } from "@/modules/employees/service";
import { testDb } from "./db";

let n = 0;

export async function makeEmployee(actor: Actor, overrides: Record<string, string> = {}) {
  n++;
  return createEmployee(testDb(), actor, {
    fullName: `Colaborador Teste ${n}`,
    jobTitle: "Atendente",
    team: "Central",
    startDate: "2025-01-10",
    status: "ACTIVE",
    ...overrides,
  });
}

export async function scheduleByName(prefix: string) {
  return testDb().workSchedule.findFirstOrThrow({ where: { name: { startsWith: prefix } } });
}

export async function occurrenceType(code: string) {
  return testDb().occurrenceType.findUniqueOrThrow({ where: { code } });
}
