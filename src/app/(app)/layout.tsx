import { requireActor } from "@/lib/auth/dal";
import { can } from "@/lib/permissions";
import { ROLE } from "@/lib/labels";
import { AppShell, type NavKey } from "@/components/layout/app-shell";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireActor();
  const allowed: NavKey[] = ["dashboard"];
  if (can(actor, "employees:read")) allowed.push("employees");
  if (can(actor, "meetings:read")) allowed.push("meetings");
  if (can(actor, "attendance:read")) allowed.push("attendance");
  if (can(actor, "metrics:read")) allowed.push("metrics");
  if (can(actor, "feedbacks:read")) allowed.push("feedbacks");
  if (can(actor, "tasks:read")) allowed.push("tasks");
  if (can(actor, "reports:export")) allowed.push("reports");
  allowed.push("settings");

  return (
    <AppShell allowed={allowed} user={{ name: actor.name, role: ROLE[actor.role].label }} logout={logoutAction}>
      {children}
    </AppShell>
  );
}
