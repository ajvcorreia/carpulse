"use client";

import { BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { CarWithPrices } from "@/lib/types";

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "AED", maximumFractionDigits: 0 });
}

type ModelPoint = { model: string; avgPrice: number; count: number };

function ModelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ModelPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm">
      <div className="text-text-secondary">{point.model}</div>
      <div className="tabular-nums font-medium text-text-primary">{formatCurrency(point.avgPrice)} avg</div>
      <div className="text-xs text-text-muted">
        {point.count} car{point.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// Shown when a Make is chosen but no Model yet — averages current price
// across trims of the same make, so you can see the price gap between them
// before narrowing to one and getting the full per-car comparison chart.
export function ModelComparisonChart({ make, cars }: { make: string; cars: CarWithPrices[] }) {
  const byModel = new Map<string, number[]>();
  for (const car of cars) {
    if (car.price_history.length === 0) continue;
    const latest = car.price_history[car.price_history.length - 1].price;
    const list = byModel.get(car.model);
    if (list) list.push(latest);
    else byModel.set(car.model, [latest]);
  }

  const data: ModelPoint[] = Array.from(byModel.entries())
    .map(([model, prices]) => ({
      model,
      avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length,
    }))
    .sort((a, b) => a.avgPrice - b.avgPrice);

  if (data.length < 2) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h2 className="text-sm font-medium text-text-secondary">Average price by {make} model</h2>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--gridline)" strokeWidth={1} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2)]}
              stroke="var(--baseline)"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--baseline)" }}
              tickFormatter={(v: number) => v.toLocaleString()}
            />
            <YAxis
              type="category"
              dataKey="model"
              width={130}
              stroke="var(--baseline)"
              tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ModelTooltip />} cursor={{ fill: "var(--gridline)" }} />
            <Bar dataKey="avgPrice" fill="var(--series-1)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="avgPrice"
                position="right"
                formatter={(v) => (typeof v === "number" ? formatCurrency(v) : "")}
                fill="var(--text-secondary)"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
