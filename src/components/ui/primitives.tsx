import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Info } from "lucide-react";
import type { Tone } from "@/lib/labels";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="display break-words">{title}</h1>
        {description ? <div className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  description,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
}) {
  return (
    <section className={cx("panel", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="subheading">{title}</h2> : null}
            {description ? <p className="mt-1 text-[13px] leading-relaxed text-subtle">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "badge badge-neutral",
  ok: "badge badge-ok",
  warn: "badge badge-warn",
  danger: "badge badge-danger",
  info: "badge badge-info",
  accent: "badge badge-accent",
};

/** Etiqueta com ponto + texto: a informação nunca depende apenas da cor. */
export function Badge({ tone = "neutral", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={TONE_CLASS[tone]}>
      {icon ? <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}

export function LabelBadge<T extends string>({ map, value }: { map: Record<T, { label: string; tone: Tone }>; value: T }) {
  const entry = map[value];
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="dot-grid flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface-2/40 px-6 py-10 text-center">
      {icon ? <div className="mb-1 grid size-10 place-items-center rounded-full border border-line bg-surface text-subtle">{icon}</div> : null}
      <p className="text-[15px] font-semibold">{title}</p>
      {description ? <p className="max-w-xl text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "warn" | "danger";
}) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {href ? <ArrowUpRight className="size-3.5 text-subtle transition group-hover:text-primary" aria-hidden /> : null}
      </p>
      <p className={cx("num mt-3 text-[28px]", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</p>
      {hint ? <p className="mt-2 text-[12px] text-subtle">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="panel-tight group block transition-colors hover:bg-surface-2/50">
      {body}
    </Link>
  ) : (
    <div className="panel-tight">{body}</div>
  );
}

export function DescriptionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="eyebrow">{item.label}</dt>
          <dd className="mt-1.5 text-[14.5px] break-words">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("divider my-[18px]", className)} />;
}

/** Preserva os filtros atuais ao montar links de paginação/ordenação. */
export function buildHref(base: string, params: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export function Pagination({
  base,
  params,
  page,
  pageCount,
  total,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <nav aria-label="Paginação" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-subtle">
      <span>
        {total} {total === 1 ? "registro" : "registros"} · página {page} de {Math.max(pageCount, 1)}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="btn-secondary btn btn-sm" href={buildHref(base, params, { page: String(page - 1) })}>
            <ChevronLeft className="size-3.5" aria-hidden /> Anterior
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link className="btn-secondary btn btn-sm" href={buildHref(base, params, { page: String(page + 1) })}>
            Próxima <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function SortHeader({
  base,
  params,
  field,
  children,
  className,
}: {
  base: string;
  params: Record<string, string | undefined>;
  field: string;
  children: ReactNode;
  className?: string;
}) {
  const active = params.sort === field;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  return (
    <th className={className} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={buildHref(base, params, { sort: field, dir, page: undefined })} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        {active ? params.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : null}
      </Link>
    </th>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "info" ? Info : CircleAlert;
  const color = { info: "border-primary/20 bg-primary-soft/60 text-primary", warn: "border-warn/20 bg-warn-soft/60 text-warn", danger: "border-danger/20 bg-danger-soft/60 text-danger", ok: "border-ok/20 bg-ok-soft/60 text-[#15803d]" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-[var(--radius-card)] border px-4 py-3 text-sm", color)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-ink/90">{children}</div>
    </div>
  );
}

export function Tabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav aria-label="Seções" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {items.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors",
                t.key === active ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? <span className="font-mono text-[11px] text-subtle">{t.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
