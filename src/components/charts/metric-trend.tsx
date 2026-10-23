"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = {
  /** AAAA-MM (mensal) ou AAAA-MM-DD (diário) */
  month: string;
  tickets: number | null;
  aht: number | null;
  rating: number | null;
  compareTickets?: number | null;
  compareAht?: number | null;
  compareRating?: number | null;
};

const METRICS = {
  tickets: { label: "Chamados", unit: "", compare: "compareTickets" as const, digits: 0 },
  aht: { label: "Tempo médio (min)", unit: " min", compare: "compareAht" as const, digits: 2 },
  rating: { label: "Avaliação", unit: "", compare: "compareRating" as const, digits: 2 },
};
type MetricKey = keyof typeof METRICS;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" → "out/26"; "2026-10-05" → "05/10". */
export function shortMonth(key: string): string {
  const [y, m, d] = key.split("-");
  return d ? `${d}/${m}` : `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

const BLUE = "#2563eb";
const GRAY = "#94a3b8";
const GRID = "#e2e8f0";
const TICK = { fill: "#64748b", fontSize: 11 };
const TOOLTIP = {
  contentStyle: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0b1220", fontSize: 12, boxShadow: "0 8px 24px rgba(15,23,42,0.08)" },
  labelStyle: { color: "#475569", marginBottom: 4 },
};

function fmt(n: number | null | undefined, digits: number) {
  if (n === null || n === undefined) return "sem registro";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Série de um indicador por vez (sem eixos duplos). Períodos sem lançamento aparecem
 * como lacunas — nunca como zero.
 */
export function MetricTrend({
  data,
  compareLabel,
  primaryLabel = "Selecionado",
  height = 260,
  initial = "tickets",
  emptyLabel = "Meses sem registro",
}: {
  data: TrendPoint[];
  compareLabel?: string;
  primaryLabel?: string;
  height?: number;
  initial?: MetricKey;
  emptyLabel?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>(initial);
  const cfg = METRICS[metric];
  const missing = data.filter((d) => d[metric] === null).map((d) => shortMonth(d.month));
  const hasCompare = Boolean(compareLabel) && data.some((d) => d[cfg.compare] !== null && d[cfg.compare] !== undefined);
  const rows = data.map((d) => ({ ...d, label: shortMonth(d.month) }));
  const daily = data[0]?.month.split("-").length === 3;

  return (
    <div>
      <div role="tablist" aria-label="Indicador" className="mb-4 inline-flex gap-1 rounded-lg bg-surface-2 p-1">
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={metric === k}
            onClick={() => setMetric(k)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${metric === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {METRICS[k].label}
          </button>
        ))}
      </div>
      <div style={{ height }} className="w-full" role="img" aria-label={`Gráfico de ${cfg.label} por ${daily ? "dia" : "mês"}`}>
        <ResponsiveContainer width="100%" height="100%">
          {daily && metric === "tickets" ? (
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <Tooltip cursor={{ fill: "rgba(37,99,235,0.06)" }} {...TOOLTIP} formatter={(v) => [fmt(typeof v === "number" ? v : null, 0), primaryLabel]} />
              <Bar dataKey="tickets" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} domain={metric === "rating" ? [0, 10] : ["auto", "auto"]} allowDecimals={metric !== "tickets"} />
              <Tooltip
                cursor={{ stroke: GRID }}
                {...TOOLTIP}
                formatter={(value, name) => [fmt(typeof value === "number" ? value : null, cfg.digits) + (typeof value === "number" ? cfg.unit : ""), name === "compare" ? compareLabel : primaryLabel]}
              />
              {hasCompare ? (
                <Line type="monotone" dataKey={cfg.compare} name="compare" stroke={GRAY} strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false} />
              ) : null}
              <Line
                type="monotone"
                dataKey={metric}
                name="primary"
                stroke={BLUE}
                strokeWidth={2.5}
                dot={{ r: 3, fill: BLUE, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: BLUE, stroke: "#fff", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-primary" aria-hidden /> {primaryLabel}
        </span>
        {hasCompare ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-line-strong" aria-hidden /> {compareLabel}
          </span>
        ) : null}
        {missing.length && !daily ? <span>{emptyLabel}: {missing.join(", ")}</span> : null}
        {daily ? <span>{data.length - missing.length} dia(s) com lançamento</span> : null}
      </div>
    </div>
  );
}

export function CountBars({ data, label, height = 180 }: { data: Array<{ month: string; value: number }>; label: string; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: shortMonth(d.month) }));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: "rgba(37,99,235,0.06)" }} {...TOOLTIP} formatter={(v) => [String(v), label]} />
          <Bar dataKey="value" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
