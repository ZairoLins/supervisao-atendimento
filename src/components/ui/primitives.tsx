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
    <header className="mb-7 flex flex-col gap-5 border-b border-line pb-6 md:mb-9 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
        <h1 className="display break-words">{title}</h1>
        {description ? <div className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-muted">{description}</div> : null}
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
        <div className="-mx-[var(--spacing-panel)] -mt-1 mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-line px-[var(--spacing-panel)] pb-4">
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
    <div className="flex flex-col items-center gap-2.5 rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-subtle">{icon}</div> : null}
      <p className="font-serif text-[22px] leading-tight">{title}</p>
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
        <span className="eyebrow">{label}</span>
        {href ? <ArrowUpRight className="size-3.5 text-subtle transition group-hover:text-ink" aria-hidden /> : null}
      </p>
      <p className={cx("num mt-4 text-[40px]", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{value}</p>
      {hint ? <p className="mt-3 text-[12.5px] text-subtle">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="panel-tight group block transition-colors hover:border-ink/30">
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
  const color = { info: "border-primary bg-primary-soft text-primary", warn: "border-warn bg-warn-soft text-warn", danger: "border-danger bg-danger-soft text-danger", ok: "border-ok bg-ok-soft text-ok" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-r-lg border-l-2 px-4 py-3 text-sm", color)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-ink/90">{children}</div>
    </div>
  );
}

export function Tabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav aria-label="Seções" className="-mx-4 mb-7 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-6 border-b border-line">
        {items.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 pt-1 pb-3 text-[14px] font-medium transition-colors",
                t.key === active ? "border-ink text-ink" : "border-transparent text-subtle hover:text-ink",
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
