import "server-only";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { FEEDBACK_TYPE } from "@/lib/labels";
import { can, type Actor } from "@/lib/permissions";
import { assigneeOptions } from "@/modules/tasks/service";
import { employeeOptions } from "@/modules/employees/service";
import { meetingOptions } from "@/modules/meetings/service";

/** Opções dos selects do formulário de tarefa, respeitando as permissões do usuário. */
export async function taskFormOptions(actor: Actor, include: { employeeId?: string | null; feedbackId?: string | null } = {}) {
  const [assignees, employees, meetings, feedbacks] = await Promise.all([
    assigneeOptions(db, actor),
    can(actor, "employees:read") ? employeeOptions(db, actor, { includeId: include.employeeId }) : Promise.resolve([]),
    can(actor, "meetings:read") ? meetingOptions(db, actor) : Promise.resolve([]),
    can(actor, "feedbacks:read")
      ? db.feedback
          .findMany({
            where: { deletedAt: null, OR: [{ status: { not: "CLOSED" } }, ...(include.feedbackId ? [{ id: include.feedbackId }] : [])] },
            include: { employee: { select: { fullName: true } } },
            orderBy: { date: "desc" },
            take: 200,
          })
          .then((rows) => rows.map((f) => ({ value: f.id, label: `${formatDate(f.date)} · ${FEEDBACK_TYPE[f.type].label} — ${f.employee.fullName}` })))
      : Promise.resolve(null),
  ]);
  return { assignees, employees, meetings, feedbacks };
}
