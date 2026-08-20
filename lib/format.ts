import type { PricePoint } from "@/lib/types";

export function formatPrice(price: number, currency: string) {
  return price.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
}

export function latestDelta(points: PricePoint[]) {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  return latest.price - previous.price;
}

// ad_placed_at is a plain date ("2026-08-05"), so compare calendar days
// rather than exact timestamps to avoid off-by-one from time-of-day.
export function daysOnDubizzle(adPlacedAt: string | null): number | null {
  if (!adPlacedAt) return null;
  const placed = new Date(`${adPlacedAt}T00:00:00Z`);
  if (Number.isNaN(placed.getTime())) return null;
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((todayUtc - placed.getTime()) / (24 * 60 * 60 * 1000)));
}
