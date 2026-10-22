import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { can, type Actor } from "@/lib/permissions";
import { Panel } from "@/components/ui/primitives";

const FIELD_LABELS: Record<string, string> = {
  date: "Data",
  startMinute: "Início (min)",
  endMinute: "Fim (min)",
  typeId: "Tipo",
  employeeId: "Colaborador",
  adminNotes: "Observação",
  restrictedNotes: "Informação restrita",
  reviewStatus: "Conferência",
  ticketsHandled: "Chamados",
  avgHandleMinutes: "TMA",
  avgRating: "Avaliação",
  notes: "Observações",
  status: "Situação",
  fullName: "Nome",
  jobTitle: "Função",
  team: "Equipe",
  deletedAt: "Exclusão",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/** Histórico de auditoria de um registro (somente perfis com permissão de auditoria). */
export async function AuditTrail({ actor, entityType, entityId }: { actor: Actor; entityType: string; entityId: string }) {
  if (!can(actor, "audit:read")) return null;
  const logs = await db.auditLog.findMany({
    where: { entityType, entityId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  if (logs.length === 0) return null;
  const tz = env().APP_TIMEZONE;
  return (
    <Panel title="Histórico de alterações">
      <ol className="flex flex-col gap-4 text-sm">
        {logs.map((l) => {
          const changes = (l.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
          const keys = Object.keys(changes).filter((k) => k !== "searchText");
          return (
            <li key={l.id} className="border-b border-dashed border-cork pb-4 last:border-0 last:pb-0">
              <p>{l.summary}</p>
              <p className="mt-0.5 text-xs text-subtle">
                {formatDateTime(l.createdAt, tz)} · {l.user?.name ?? "Sistema"}
              </p>
              {l.reason ? <p className="mt-1.5 text-xs text-muted">Motivo: {l.reason}</p> : null}
              {keys.length && l.action !== "CREATE" ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
                  {keys.map((k) => (
                    <li key={k}>
                      <span className="text-subtle">{FIELD_LABELS[k] ?? k}:</span> {show(changes[k].from)} → {show(changes[k].to)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
