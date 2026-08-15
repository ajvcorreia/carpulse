"use client";

import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import type { PricePoint } from "@/lib/types";

export function Sparkline({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return <span className="text-xs text-text-muted">Not enough data</span>;
  }

  const data = points.map((p) => ({ recorded_at: p.recorded_at, price: p.price }));

  // Same zero-baseline fix as PriceChart: pad around min/max instead of
  // letting the implicit scale start at 0, or small moves render as flat.
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = Math.max((max - min) * 0.15, max * 0.02, 1);
  const yDomain: [number, number] = [Math.max(0, min - padding), max + padding];

  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis domain={yDomain} hide />
          <Line
            type="monotone"
            dataKey="price"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
