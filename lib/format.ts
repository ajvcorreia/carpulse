import type { PricePoint } from "@/lib/types";

export function formatPrice(price: number, currency: string) {
  return price.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
}

// day/month/year, always — locale-dependent formatting (toLocaleDateString
// with no explicit locale) would otherwise flip to month/day/year depending
// on the server's system locale, which is exactly the ambiguity this exists
// to avoid. Accepts either a plain date ("2026-08-05") or a full ISO
// timestamp; a bare date is anchored to UTC midnight so it doesn't shift a
// day depending on the reader's timezone.
export function formatDMY(dateStr: string | null): string {
  if (!dateStr) return "—";
  const iso = dateStr.length <= 10 ? `${dateStr}T00:00:00Z` : dateStr;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

// Total change from the first recorded price to the latest — how much the
// car has moved since tracking started, not just the most recent update.
export function totalDelta(points: PricePoint[]) {
  if (points.length < 2) return null;
  const first = points[0];
  const latest = points[points.length - 1];
  return latest.price - first.price;
}

// ad_placed_at is a plain date ("2026-08-05"), so compare calendar days
// rather than exact timestamps to avoid off-by-one from time-of-day.
export function daysListed(adPlacedAt: string | null): number | null {
  if (!adPlacedAt) return null;
  const placed = new Date(`${adPlacedAt}T00:00:00Z`);
  if (Number.isNaN(placed.getTime())) return null;
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((todayUtc - placed.getTime()) / (24 * 60 * 60 * 1000)));
}
