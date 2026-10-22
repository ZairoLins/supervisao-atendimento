"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = {
  month: string;
  tickets: number | null;
  aht: number | null;
  rating: number | null;
  compareTickets?: number | null;
  compareAht?: number | null;
  compareRating?: number | null;
};

const METRICS = {
  tickets: { label: "Chamados atendidos", unit: "", compare: "compareTickets" as const, digits: 0 },
  aht: { label: "Tempo médio (min)", unit: " min", compare: "compareAht" as const, digits: 2 },
  rating: { label: "Avaliação média", unit: "", compare: "compareRating" as const, digits: 2 },
};
type MetricKey = keyof typeof METRICS;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
}

const AXIS = { stroke: "#6c5f51", fontSize: 11, tickLine: false, axisLine: false } as const;

function fmt(n: number | null | undefined, digits: number) {
  if (n === null || n === undefined) return "sem registro";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Série mensal de um indicador por vez (sem eixos duplos). Meses sem registro aparecem
 * como lacunas na linha — nunca como zero.
 */
export function MetricTrend({
  data,
  compareLabel,
  primaryLabel = "Selecionado",
  height = 260,
  initial = "tickets",
}: {
  data: TrendPoint[];
  compareLabel?: string;
  primaryLabel?: string;
  height?: number;
  initial?: MetricKey;
}) {
  const [metric, setMetric] = useState<MetricKey>(initial);
  const cfg = METRICS[metric];
  const missing = data.filter((d) => d[metric] === null).map((d) => shortMonth(d.month));
  const hasCompare = Boolean(compareLabel) && data.some((d) => d[cfg.compare] !== null && d[cfg.compare] !== undefined);
  const rows = data.map((d) => ({ ...d, label: shortMonth(d.month) }));

  return (
    <div>
      <div role="tablist" aria-label="Indicador" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={metric === k}
            onClick={() => setMetric(k)}
            className={`btn btn-sm ${metric === k ? "btn-primary" : "btn-ghost"}`}
          >
            {METRICS[k].label}
          </button>
        ))}
      </div>
      <div style={{ height }} className="w-full" role="img" aria-label={`Gráfico de ${cfg.label} por mês`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#40372e" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" {...AXIS} tick={{ fill: "#a3927e" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...AXIS} tick={{ fill: "#a3927e" }} width={48} domain={metric === "rating" ? [0, 10] : ["auto", "auto"]} allowDecimals={metric !== "tickets"} />
            <Tooltip
              cursor={{ stroke: "#6c5f51", strokeDasharray: "2 3" }}
              contentStyle={{ background: "#1a110a", border: "1px solid #40372e", borderRadius: 10, color: "#ffedd7", fontSize: 12 }}
              labelStyle={{ color: "#c9b8a3", marginBottom: 4 }}
              formatter={(value, name) => [fmt(typeof value === "number" ? value : null, cfg.digits) + (typeof value === "number" ? cfg.unit : ""), name === "compare" ? compareLabel : primaryLabel]}
            />
            {hasCompare ? (
              <Line type="monotone" dataKey={cfg.compare} name="compare" stroke="#6c5f51" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={false} />
            ) : null}
            <Line
              type="monotone"
              dataKey={metric}
              name="primary"
              stroke="#ffedd7"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "#ffedd7", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "#dc5000", strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-cream" aria-hidden /> {primaryLabel}
        </span>
        {hasCompare ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-driftwood" aria-hidden /> {compareLabel}
          </span>
        ) : null}
        {missing.length ? <span>Meses sem registro: {missing.join(", ")}</span> : <span>Todos os meses do período têm registro.</span>}
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
          <CartesianGrid stroke="#40372e" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" {...AXIS} tick={{ fill: "#a3927e" }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...AXIS} tick={{ fill: "#a3927e" }} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: "rgba(255,237,215,0.04)" }}
            contentStyle={{ background: "#1a110a", border: "1px solid #40372e", borderRadius: 10, color: "#ffedd7", fontSize: 12 }}
            formatter={(v) => [String(v), label]}
          />
          <Bar dataKey="value" fill="#6c5f51" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
