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
