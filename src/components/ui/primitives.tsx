import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDot, Info, MinusCircle } from "lucide-react";
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
        {eyebrow ? <p className="eyebrow mb-3">{eyebrow}</p> : null}
        <h1 className="display break-words">{title}</h1>
        {description ? <p className="mt-3 max-w-2xl text-sm text-muted">{description}</p> : null}
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
        <div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="subheading">{title}</h2> : null}
            {description ? <p className="mt-2 text-xs text-subtle">{description}</p> : null}
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

const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: MinusCircle,
  ok: CircleCheck,
  warn: CircleAlert,
  danger: CircleAlert,
  info: Info,
  accent: CircleDot,
};

/** Etiqueta com texto + ícone: a informação nunca depende apenas da cor. */
export function Badge({ tone = "neutral", children, icon = true }: { tone?: Tone; children: ReactNode; icon?: boolean }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={TONE_CLASS[tone]}>
      {icon ? <Icon aria-hidden className="size-3" /> : null}
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
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-cork px-6 py-8">
      {icon ? <div className="text-subtle">{icon}</div> : null}
      <p className="subheading">{title}</p>
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
      <p className="eyebrow">{label}</p>
      <p className={cx("mt-4 text-3xl font-medium leading-none tabular-nums", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>
        {value}
      </p>
      {hint ? <p className="mt-3 text-xs text-subtle">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="panel-tight block transition-colors hover:border-driftwood">
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
          <dd className="mt-1.5 text-sm break-words">{item.value ?? "—"}</dd>
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
    <nav aria-label="Paginação" className="mt-[18px] flex flex-wrap items-center justify-between gap-3 text-xs text-subtle">
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
      <Link href={buildHref(base, params, { sort: field, dir, page: undefined })} className="inline-flex items-center gap-1 hover:text-cream">
        {children}
        {active ? params.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : null}
      </Link>
    </th>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "info" ? Info : CircleAlert;
  const color = { info: "border-info/30 text-info", warn: "border-warn/40 text-warn", danger: "border-danger/50 text-danger", ok: "border-ok/40 text-ok" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-2 rounded-[10px] border border-dashed px-4 py-3 text-sm", color)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-cream/90">{children}</div>
    </div>
  );
}

export function Tabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav aria-label="Seções" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-5 border-b border-dashed border-cork">
        {items.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === active ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 border-b py-3 text-xs font-medium uppercase",
                t.key === active ? "border-cream text-cream" : "border-transparent text-subtle hover:text-cream",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? <span className="text-[10px] text-subtle">{t.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
