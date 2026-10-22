"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Settings,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/search/command-palette";

export type NavKey = "dashboard" | "employees" | "meetings" | "attendance" | "metrics" | "feedbacks" | "tasks" | "reports" | "settings";

const NAV: Array<{ key: NavKey; href: string; label: string; icon: typeof Users }> = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { key: "employees", href: "/colaboradores", label: "Colaboradores", icon: Users },
  { key: "meetings", href: "/reunioes", label: "Reuniões", icon: UsersRound },
  { key: "attendance", href: "/frequencia", label: "Frequência e escalas", icon: CalendarClock },
  { key: "metrics", href: "/desempenho", label: "Desempenho", icon: BarChart3 },
  { key: "feedbacks", href: "/feedbacks", label: "Feedbacks", icon: MessageSquareText },
  { key: "tasks", href: "/tarefas", label: "Tarefas e pendências", icon: ClipboardList },
  { key: "reports", href: "/relatorios", label: "Relatórios", icon: FileSpreadsheet },
  { key: "settings", href: "/configuracoes", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  allowed,
  user,
  logout,
}: {
  children: ReactNode;
  allowed: NavKey[];
  user: { name: string; role: string };
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Fecha o menu móvel ao navegar
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = NAV.filter((n) => allowed.includes(n.key));

  const nav = (
    <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-xs font-medium uppercase transition-colors ${
              active ? "bg-bark text-cream" : "text-muted hover:bg-cream/5 hover:text-cream"
            }`}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
            {active ? <span className="ml-auto size-1.5 rounded-full bg-ember" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-4 border-t border-dashed border-cork pt-4">
      <p className="truncate text-sm">{user.name}</p>
      <p className="eyebrow mt-1">{user.role}</p>
      <form action={logout} className="mt-3">
        <button type="submit" className="btn btn-ghost btn-sm -ml-3">
          <LogOut className="size-3.5" aria-hidden /> Sair
        </button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/" className="block px-3 pb-6 pt-1">
      <span className="block text-[22px] font-medium uppercase leading-[0.9]">Supervisão</span>
      <span className="eyebrow mt-1.5 block">Atendimento · interno</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Navegação lateral persistente (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-dashed border-cork px-3 py-5 lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Menu recolhível (tablet e celular) */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-walnut/80" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[min(300px,86vw)] flex-col border-r border-cork bg-walnut px-3 py-5">
            <div className="flex items-start justify-between">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm" aria-label="Fechar menu">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-dashed border-cork bg-walnut/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-walnut/80 md:px-8">
          <button type="button" className="btn btn-ghost btn-sm -ml-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}>
            <Menu className="size-5" aria-hidden />
          </button>
          <CommandPalette />
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
