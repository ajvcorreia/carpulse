"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import type { PricePoint } from "@/lib/types";

type ChartPoint = { recorded_at: string; price: number };

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm">
      <div className="text-text-secondary">{format(new Date(point.recorded_at), "MMM d, yyyy")}</div>
      <div className="tabular-nums font-medium text-text-primary">
        {point.price.toLocaleString(undefined, { style: "currency", currency: "AED", maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}

export function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-text-muted">No price data yet.</p>;
  }

  const data = points.map((p) => ({ recorded_at: p.recorded_at, price: p.price }));

  // Recharts defaults the Y-axis to start at 0, which flattens a chart whose
  // whole point is showing a price move within a range far from zero (e.g.
  // 220k -> 230k reads as a flat line on a 0-240k scale). Pad around the
  // actual min/max instead so the movement is visible.
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = Math.max((max - min) * 0.15, max * 0.02, 1);
  const yDomain: [number, number] = [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
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
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="price"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
