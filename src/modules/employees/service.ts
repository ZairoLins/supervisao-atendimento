import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { EmployeeStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/permissions";
import { buildSearchText, formatCode, normalizeQuery } from "@/lib/text";
import { dateField, optionalText, PAGE_SIZE, requiredText } from "@/lib/validation";

export const employeeSchema = z.object({
  fullName: requiredText("o nome completo", 160),
  jobTitle: requiredText("a função", 100),
  team: requiredText("a equipe ou setor", 100),
  startDate: dateField("a data de entrada"),
  status: z.enum(["ACTIVE", "ON_LEAVE"], { error: "Situação inválida." }).default("ACTIVE"),
  workloadLabel: optionalText(120),
  generalNotes: optionalText(4000),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

function searchTextFor(e: { code: number; fullName: string; jobTitle: string; team: string }) {
  return buildSearchText(formatCode("employee", e.code), e.fullName, e.jobTitle, e.team);
}

export async function createEmployee(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "employees:write");
  const data = employeeSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const created = await tx.employee.create({ data });
    const employee = await tx.employee.update({ where: { id: created.id }, data: { searchText: searchTextFor(created) } });
    await audit(tx, {
      actorId: actor.id,
      action: "CREATE",
      entityType: "Employee",
      entityId: employee.id,
      summary: `Colaborador ${formatCode("employee", employee.code)} cadastrado`,
      after: employee,
    });
    return employee;
  });
}

export async function updateEmployee(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "employees:write");
  const data = employeeSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Colaborador não encontrado.");
    if (before.status === "INACTIVE") throw new ValidationError("Reative o colaborador antes de editar o cadastro.");
    const employee = await tx.employee.update({
      where: { id },
      data: { ...data, searchText: searchTextFor({ ...before, ...data }) },
    });
    await audit(tx, {
      actorId: actor.id,
      action: "UPDATE",
      entityType: "Employee",
      entityId: id,
      summary: `Cadastro de ${formatCode("employee", employee.code)} atualizado`,
      before,
      after: employee,
    });
    return employee;
  });
}

const inactivateSchema = z.object({
  reason: requiredText("o motivo da inativação", 500),
});

/** Inativa sem apagar históricos (frequência, métricas, feedbacks e tarefas permanecem). */
export async function inactivateEmployee(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "employees:write");
  const { reason } = inactivateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Colaborador não encontrado.");
    if (before.status === "INACTIVE") throw new ValidationError("O colaborador já está inativo.");
    const employee = await tx.employee.update({
      where: { id },
      data: { status: "INACTIVE", inactivatedAt: new Date(), inactivationReason: reason },
    });
    await audit(tx, {
      actorId: actor.id,
      action: "INACTIVATE",
      entityType: "Employee",
      entityId: id,
      summary: `Colaborador ${formatCode("employee", employee.code)} inativado`,
      before,
      after: employee,
      reason,
    });
    return employee;
  });
}

export async function reactivateEmployee(db: Db, actor: Actor, id: string) {
  assertCan(actor, "employees:write");
  return db.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Colaborador não encontrado.");
    if (before.status !== "INACTIVE") throw new ValidationError("O colaborador já está ativo.");
    const employee = await tx.employee.update({
      where: { id },
      data: { status: "ACTIVE", inactivatedAt: null, inactivationReason: null },
    });
    await audit(tx, {
      actorId: actor.id,
      action: "REACTIVATE",
      entityType: "Employee",
      entityId: id,
      summary: `Colaborador ${formatCode("employee", employee.code)} reativado`,
      before,
      after: employee,
    });
    return employee;
  });
}

export type EmployeeListFilters = {
  q?: string;
  status?: EmployeeStatus | "ALL";
  team?: string;
  jobTitle?: string;
  sort?: "name" | "code" | "team" | "startDate";
  dir?: "asc" | "desc";
  page?: number;
};

export async function listEmployees(db: Db, actor: Actor, f: EmployeeListFilters) {
  assertCan(actor, "employees:read");
  const where: Prisma.EmployeeWhereInput = {};
  if (f.status && f.status !== "ALL") where.status = f.status;
  else if (!f.status) where.status = { not: "INACTIVE" };
  if (f.team) where.team = f.team;
  if (f.jobTitle) where.jobTitle = f.jobTitle;
  const q = normalizeQuery(f.q);
  if (q) where.searchText = { contains: q };
  const dir = f.dir ?? "asc";
  const orderBy: Prisma.EmployeeOrderByWithRelationInput =
    f.sort === "code" ? { code: dir } : f.sort === "team" ? { team: dir } : f.sort === "startDate" ? { startDate: dir } : { fullName: dir };
  const page = f.page ?? 1;
  const [total, items] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({ where, orderBy: [orderBy, { fullName: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return { total, items, page, pageCount: Math.ceil(total / PAGE_SIZE) };
}

export async function getEmployee(db: Db, actor: Actor, id: string) {
  assertCan(actor, "employees:read");
  const employee = await db.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  return employee;
}

/** Opções para selects (ativos e afastados por padrão; inclui o selecionado mesmo se inativo). */
export async function employeeOptions(db: Db, actor: Actor, opts: { includeInactive?: boolean; includeId?: string | null } = {}) {
  assertCan(actor, "employees:read");
  const rows = await db.employee.findMany({
    where: opts.includeInactive
      ? {}
      : { OR: [{ status: { not: "INACTIVE" } }, ...(opts.includeId ? [{ id: opts.includeId }] : [])] },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, code: true, status: true, team: true, jobTitle: true },
  });
  return rows.map((r) => ({
    value: r.id,
    label: `${r.fullName}${r.status === "INACTIVE" ? " (inativo)" : ""}`,
    team: r.team,
    jobTitle: r.jobTitle,
  }));
}

export async function distinctTeamsAndTitles(db: Db) {
  const [teams, titles] = await Promise.all([
    db.employee.findMany({ distinct: ["team"], select: { team: true }, orderBy: { team: "asc" } }),
    db.employee.findMany({ distinct: ["jobTitle"], select: { jobTitle: true }, orderBy: { jobTitle: "asc" } }),
  ]);
  return { teams: teams.map((t) => t.team), titles: titles.map((t) => t.jobTitle) };
}
