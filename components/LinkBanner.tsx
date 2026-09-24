"use client";

import { useState, useTransition } from "react";
import { linkCars } from "@/lib/actions";
import { formatPrice, siteLabel } from "@/lib/format";
import type { CarWithPrices } from "@/lib/types";

const actionButtonClass =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary no-underline hover:border-series-1 hover:text-text-primary";

export function carLabel(car: CarWithPrices) {
  return `${car.year} ${car.make} ${car.model} — ${car.km != null ? `${car.km.toLocaleString()} km` : "no KM"}`;
}

type InfoRow = { label: string; a: string; b: string };

function buildInfoRows(a: CarWithPrices, b: CarWithPrices): InfoRow[] {
  function row(label: string, aRaw: string | number | null, bRaw: string | number | null): InfoRow {
    return {
      label,
      a: aRaw != null && String(aRaw) !== "" ? String(aRaw) : "—",
      b: bRaw != null && String(bRaw) !== "" ? String(bRaw) : "—",
    };
  }

  const aLatest = a.price_history[a.price_history.length - 1];
  const bLatest = b.price_history[b.price_history.length - 1];

  return [
    row("Site", siteLabel(a.url), siteLabel(b.url)),
    row("Year", a.year, b.year),
    row("KM", a.km?.toLocaleString() ?? null, b.km?.toLocaleString() ?? null),
    row("Spec", a.spec, b.spec),
    row(
      "Latest price",
      aLatest ? formatPrice(aLatest.price, aLatest.currency) : null,
      bLatest ? formatPrice(bLatest.price, bLatest.currency) : null
    ),
    row("Status", a.is_removed ? "Removed" : "Active", b.is_removed ? "Removed" : "Active"),
  ];
}

// Unlike MergeBanner, nothing here is combined or overridden — both cars
// stay completely independent (own price history, own removed/favorite
// status). This is purely a cross-reference, so there's no "keep as
// current" choice and no per-field picking, just a sanity-check comparison
// before confirming.
export function LinkBanner({
  sourceCar,
  targetCar,
  onCancel,
  onLinked,
}: {
  sourceCar: CarWithPrices;
  targetCar: CarWithPrices | null;
  onCancel: () => void;
  onLinked: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleLink() {
    if (!targetCar) return;
    setError(null);
    const formData = new FormData();
    formData.set("car_a_id", sourceCar.id);
    formData.set("car_b_id", targetCar.id);
    startTransition(async () => {
      const result = await linkCars(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onLinked();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-series-1 bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-secondary">
          Marking <strong className="text-text-primary">{carLabel(sourceCar)}</strong>
          {targetCar ? (
            <>
              {" "}
              also listed at <strong className="text-text-primary">{carLabel(targetCar)}</strong>
            </>
          ) : (
            " — check another car in the list below to pick which listing this also is."
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCancel} className={actionButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleLink}
            disabled={!targetCar || pending}
            className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Linking…" : "Also listed at this one"}
          </button>
        </div>
      </div>

      {targetCar ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th className="pb-1 pr-3 font-medium"></th>
                  <th className="pb-1 pr-3 font-medium">{carLabel(sourceCar)}</th>
                  <th className="pb-1 font-medium">{carLabel(targetCar)}</th>
                </tr>
              </thead>
              <tbody>
                {buildInfoRows(sourceCar, targetCar).map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-text-secondary">{r.label}</td>
                    <td className="py-1.5 pr-3">{r.a}</td>
                    <td className="py-1.5">{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-text-secondary">
            Both listings stay fully independent — their own price history, own removed/favorite status. Linking
            just connects them so you can see they&apos;re the same car; unlink any time from either one&apos;s
            expanded card.
          </p>
        </>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}
    </div>
  );
}
