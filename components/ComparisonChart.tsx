"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { CarWithPrices } from "@/lib/types";

type Mode = "history" | "current";

// A fixed, colorblind-safe hue order (Okabe-Ito plus two extensions) so a
// given car keeps the same color across renders regardless of sort order —
// never cycled or reassigned by position, per the project's charting rules.
// The first slot deliberately matches the app's own accent color (--series-1)
// so a single-car comparison still reads as "the" CarPulse blue.
const PALETTE = [
  "#2a78d6",
  "#e69f00",
  "#009e73",
  "#d55e00",
  "#cc79a7",
  "#56b4e9",
  "#8b5cf6",
  "#4d4d4d",
  "#b2182b",
  "#1b7837",
];

const MAX_SERIES = PALETTE.length;

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash;
}

// Assigns each car a palette slot by hashing its id (stable across re-renders
// and filter changes — a car keeps its color even if others drop out of the
// comparison), then resolves any hash collisions within the current set by
// probing forward to the next free slot.
function assignColors(carIds: string[]): Map<string, string> {
  const used = new Set<number>();
  const colors = new Map<string, string>();
  for (const id of carIds) {
    let idx = hashString(id) % PALETTE.length;
    let attempts = 0;
    while (used.has(idx) && attempts < PALETTE.length) {
      idx = (idx + 1) % PALETTE.length;
      attempts++;
    }
    used.add(idx);
    colors.set(id, PALETTE[idx]);
  }
  return colors;
}

function carLabel(car: CarWithPrices) {
  return `${car.year} · ${car.km != null ? `${car.km.toLocaleString()} km` : "no KM"}`;
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "AED", maximumFractionDigits: 0 });
}

function CurrentPriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; price: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm">
      <div className="text-text-secondary">{point.label}</div>
      <div className="tabular-nums font-medium text-text-primary">{formatCurrency(point.price)}</div>
    </div>
  );
}

function ComparisonTooltip({
  active,
  payload,
  label,
  cars,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  cars: CarWithPrices[];
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm">
      <div className="mb-1 text-text-secondary">{format(new Date(label), "MMM d, yyyy")}</div>
      <div className="space-y-1">
        {payload.map((entry) => {
          const car = cars.find((c) => c.id === entry.dataKey);
          if (!car) return null;
          return (
            <div key={entry.dataKey} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-text-secondary">{carLabel(car)}</span>
              <span className="tabular-nums font-medium text-text-primary">{formatCurrency(entry.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const modeButtonClass = (active: boolean) =>
  `rounded-md px-2 py-1 text-xs font-medium ${
    active ? "bg-series-1 text-white" : "text-text-secondary hover:text-text-primary"
  }`;

export function ComparisonChart({ cars }: { cars: CarWithPrices[] }) {
  const [mode, setMode] = useState<Mode>("history");

  const withPrices = cars.filter((c) => c.price_history.length > 0);
  if (withPrices.length === 0) return null;

  const shown = withPrices.slice(0, MAX_SERIES);
  const hiddenCount = withPrices.length - shown.length;
  const colorFor = assignColors(shown.map((c) => c.id));

  const allPrices = shown.flatMap((c) => c.price_history.map((p) => p.price));
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const padding = Math.max((max - min) * 0.15, max * 0.02, 1);
  const yDomain: [number, number] = [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];

  // One merged row per distinct recorded_at across every shown car; each
  // car's own key is only present on dates it actually has a price for.
  // connectNulls on each Line bridges the gaps so a car's line still reads
  // continuously even though the cars weren't priced on the same days.
  const dates = Array.from(new Set(shown.flatMap((c) => c.price_history.map((p) => p.recorded_at)))).sort();
  const historyData = dates.map((date) => {
    const row: Record<string, string | number> = { recorded_at: date };
    for (const car of shown) {
      const point = car.price_history.find((p) => p.recorded_at === date);
      if (point) row[car.id] = point.price;
    }
    return row;
  });

  // Cheapest first — the point of this view is "which one's the best deal
  // right now," so ranking beats matching the line chart's series order.
  const currentData = [...shown]
    .map((car) => ({
      id: car.id,
      label: carLabel(car),
      price: car.price_history[car.price_history.length - 1].price,
    }))
    .sort((a, b) => a.price - b.price);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-secondary">
          Comparing {shown.length} car{shown.length === 1 ? "" : "s"}
        </h2>
        <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
          <button type="button" onClick={() => setMode("history")} className={modeButtonClass(mode === "history")}>
            Over time
          </button>
          <button type="button" onClick={() => setMode("current")} className={modeButtonClass(mode === "current")}>
            Current price
          </button>
        </div>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "history" ? (
            <LineChart data={historyData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--gridline)" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="recorded_at"
                tickFormatter={(v: string) => format(new Date(v), "MMM d")}
                stroke="var(--baseline)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--baseline)" }}
              />
              <YAxis
                width={64}
                domain={yDomain}
                stroke="var(--baseline)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <Tooltip content={<ComparisonTooltip cars={shown} />} />
              {shown.length > 1 ? (
                <Legend
                  formatter={(value: string) => {
                    const car = shown.find((c) => c.id === value);
                    return <span className="text-text-secondary">{car ? carLabel(car) : value}</span>;
                  }}
                  wrapperStyle={{ fontSize: 12 }}
                />
              ) : null}
              {shown.map((car) => (
                <Line
                  key={car.id}
                  type="monotone"
                  dataKey={car.id}
                  stroke={colorFor.get(car.id)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  connectNulls
                  dot={{ r: 3, fill: colorFor.get(car.id), stroke: "var(--surface)", strokeWidth: 1 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={currentData} layout="vertical" margin={{ top: 8, right: 64, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--gridline)" strokeWidth={1} horizontal={false} />
              <XAxis
                type="number"
                // Padded past the highest bar (rather than domain="dataMax")
                // so its direct value label has room to sit past the bar's
                // end instead of getting clipped by the plot edge.
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]}
                stroke="var(--baseline)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--baseline)" }}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                stroke="var(--baseline)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CurrentPriceTooltip />} cursor={{ fill: "var(--gridline)" }} />
              <Bar dataKey="price" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {currentData.map((d) => (
                  <Cell key={d.id} fill={colorFor.get(d.id)} />
                ))}
                <LabelList
                  dataKey="price"
                  position="right"
                  formatter={(v) => (typeof v === "number" ? formatCurrency(v) : "")}
                  fill="var(--text-secondary)"
                  fontSize={12}
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {hiddenCount > 0 ? (
        <p className="text-xs text-text-muted">
          +{hiddenCount} more not shown — narrow the filters to compare fewer at once.
        </p>
      ) : null}
    </div>
  );
}
