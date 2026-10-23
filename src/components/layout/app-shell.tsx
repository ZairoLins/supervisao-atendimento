"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  FileSpreadsheet,
  KanbanSquare,
  Headset,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Send,
  Settings,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { CommandPalette } from "@/components/search/command-palette";

export type NavKey = "dashboard" | "kanban" | "employees" | "meetings" | "attendance" | "metrics" | "feedbacks" | "reports" | "whatsapp" | "settings";

const NAV: Array<{ key: NavKey; href: string; label: string; icon: typeof Users }> = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { key: "kanban", href: "/kanban", label: "Minha semana", icon: KanbanSquare },
  { key: "employees", href: "/colaboradores", label: "Colaboradores", icon: Users },
  { key: "attendance", href: "/frequencia", label: "Frequência e escalas", icon: CalendarClock },
  { key: "metrics", href: "/desempenho", label: "Desempenho", icon: BarChart3 },
  { key: "meetings", href: "/reunioes", label: "Reuniões", icon: UsersRound },
  { key: "feedbacks", href: "/feedbacks", label: "Feedbacks", icon: MessageSquareText },
  { key: "reports", href: "/relatorios", label: "Relatórios", icon: FileSpreadsheet },
  { key: "whatsapp", href: "/whatsapp", label: "WhatsApp", icon: Send },
  { key: "settings", href: "/configuracoes", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar px-3 py-5 text-white">
      <Link href="/" className="mb-8 flex items-center gap-3 px-2">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-white">
          <Headset className="size-5" aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold">Supervisão</span>
          <span className="block text-xs text-white/50">Atendimento</span>
        </span>
      </Link>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-primary text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-sidebar-2 p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(user.name)}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block text-xs text-white/50">{user.role}</span>
        </span>
        <form action={logout}>
          <button type="submit" className="grid size-8 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sair" title="Sair">
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[min(280px,86vw)]">
            {sidebar}
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-5 grid size-8 place-items-center rounded-md text-white/70 hover:bg-white/10" aria-label="Fechar menu">
              <X className="size-4" aria-hidden />
            </button>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:px-8">
          <button type="button" className="btn btn-ghost btn-sm -ml-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}>
            <Menu className="size-5" aria-hidden />
          </button>
          <CommandPalette />
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
