"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  FileSpreadsheet,
  KanbanSquare,
  LayoutGrid,
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
import { IdxMark } from "@/components/brand/idx-logo";

export type NavKey = "dashboard" | "kanban" | "employees" | "meetings" | "attendance" | "metrics" | "feedbacks" | "reports" | "whatsapp" | "settings";

type NavItem = { key: NavKey; href: string; label: string; icon: typeof Users };

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Rotina",
    items: [
      { key: "dashboard", href: "/", label: "Visão geral", icon: LayoutGrid },
      { key: "kanban", href: "/kanban", label: "Minha semana", icon: KanbanSquare },
      { key: "meetings", href: "/reunioes", label: "Reuniões", icon: UsersRound },
    ],
  },
  {
    title: "Equipe",
    items: [
      { key: "employees", href: "/colaboradores", label: "Colaboradores", icon: Users },
      { key: "attendance", href: "/frequencia", label: "Frequência e escalas", icon: CalendarClock },
      { key: "metrics", href: "/desempenho", label: "Desempenho", icon: BarChart3 },
      { key: "feedbacks", href: "/feedbacks", label: "Feedbacks", icon: MessageSquareText },
    ],
  },
  {
    title: "Envios",
    items: [
      { key: "reports", href: "/relatorios", label: "Relatórios", icon: FileSpreadsheet },
      { key: "whatsapp", href: "/whatsapp", label: "WhatsApp", icon: Send },
    ],
  },
];

const SETTINGS: NavItem = { key: "settings", href: "/configuracoes", label: "Configurações", icon: Settings };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Marca IDX (fundo preto arredondado). */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return <IdxMark className={`${className} shrink-0`} />;
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <LogoMark className="size-9" />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-[-0.01em]">Supervisão</span>
        <span className="block text-[11.5px] text-subtle">Atendimento</span>
      </span>
    </Link>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-[13.5px] transition-colors ${
        active ? "bg-primary-soft font-medium text-ink" : "text-muted hover:bg-black/[0.04] hover:text-ink"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-subtle group-hover:text-ink"}`} strokeWidth={1.75} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
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

  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => allowed.includes(i.key)) })).filter((s) => s.items.length);

  const sidebar = (
    <div className="flex h-full flex-col border-r border-line bg-[#fafafa] px-3 pt-5 pb-3">
      <Wordmark />
      <nav aria-label="Navegação principal" className="mt-7 flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="mb-1 px-2 text-[11.5px] font-medium text-subtle">{s.title}</p>
            <div className="flex flex-col gap-0.5">
              {s.items.map((item) => (
                <NavLink key={item.key} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-4 flex flex-col gap-0.5">
        {allowed.includes("settings") ? <NavLink item={SETTINGS} pathname={pathname} /> : null}
        <div className="mt-2 flex items-center gap-2.5 rounded-[8px] border border-line bg-surface px-2 py-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-ink">{initials(user.name)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13.5px] font-medium">{user.name}</span>
            <span className="block text-xs text-subtle">{user.role}</span>
          </span>
          <form action={logout}>
            <button type="submit" className="grid size-7 place-items-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Sair" title="Sair">
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[min(290px,86vw)] shadow-2xl">
            {sidebar}
            <button type="button" onClick={() => setOpen(false)} className="absolute top-5 right-3 grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Fechar menu">
              <X className="size-4" aria-hidden />
            </button>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/80 px-4 py-2.5 backdrop-blur-md md:px-8">
          <button type="button" className="btn btn-ghost btn-sm -ml-1.5 px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}>
            <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold lg:hidden">
            <LogoMark className="size-7" /> Supervisão
          </Link>
          <div className="ml-auto flex w-full max-w-md justify-end lg:ml-0 lg:max-w-lg lg:justify-start">
            <CommandPalette />
          </div>
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-16 md:px-8 md:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
