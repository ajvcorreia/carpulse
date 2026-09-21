"use client";

import { useState, useTransition } from "react";
import { mergeCars } from "@/lib/actions";
import { formatPrice } from "@/lib/format";
import type { CarWithPrices } from "@/lib/types";

const actionButtonClass =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary no-underline hover:border-series-1 hover:text-text-primary";

export function carLabel(car: CarWithPrices) {
  return `${car.year} ${car.make} ${car.model} — ${car.km != null ? `${car.km.toLocaleString()} km` : "no KM"}`;
}

function normalizeCompare(v: string | number | null | undefined) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

type CompareRow = { label: string; a: string; b: string; flagDiff: boolean };

// flagDiff only fires for fields that actually signal "maybe not the same
// car" — make/model/colors aren't included since both cars here were
// deliberately picked by the user, not fuzzy-matched.
function buildCompareRows(a: CarWithPrices, b: CarWithPrices): CompareRow[] {
  function row(label: string, aRaw: string | number | null, bRaw: string | number | null, flag: boolean): CompareRow {
    return {
      label,
      a: aRaw != null && String(aRaw) !== "" ? String(aRaw) : "—",
      b: bRaw != null && String(bRaw) !== "" ? String(bRaw) : "—",
      flagDiff: flag && normalizeCompare(aRaw) !== normalizeCompare(bRaw),
    };
  }

  const aLatest = a.price_history[a.price_history.length - 1];
  const bLatest = b.price_history[b.price_history.length - 1];

  return [
    row("Year", a.year, b.year, true),
    row("KM", a.km?.toLocaleString() ?? null, b.km?.toLocaleString() ?? null, false),
    row("Cylinders", a.cylinders, b.cylinders, true),
    row("Spec", a.spec, b.spec, true),
    row("Ext. color", a.exterior_color, b.exterior_color, true),
    row("Int. color", a.interior_color, b.interior_color, true),
    row("Ad placed", a.ad_placed_at, b.ad_placed_at, false),
    row(
      "Latest price",
      aLatest ? formatPrice(aLatest.price, aLatest.currency) : null,
      bLatest ? formatPrice(bLatest.price, bLatest.currency) : null,
      false
    ),
    row("Price points", a.price_history.length, b.price_history.length, false),
  ];
}

// A banner pinned above the car list while a merge is in progress. The
// source car was picked by pressing "Merge with another car" on its
// expanded card; the target is picked by checking it in the list itself
// (CarsTable renders a checkbox per other row while this is active), which
// is why this component only ever receives sourceCar/targetCar as props
// rather than offering its own picker UI.
export function MergeBanner({
  sourceCar,
  targetCar,
  keepId,
  onKeepChange,
  onCancel,
  onMerged,
}: {
  sourceCar: CarWithPrices;
  targetCar: CarWithPrices | null;
  keepId: string | null;
  onKeepChange: (id: string) => void;
  onCancel: () => void;
  onMerged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleMerge() {
    if (!targetCar || !keepId) return;
    const mergeFromId = keepId === sourceCar.id ? targetCar.id : sourceCar.id;
    setError(null);
    const formData = new FormData();
    formData.set("keep_car_id", keepId);
    formData.set("merge_from_car_id", mergeFromId);
    startTransition(async () => {
      const result = await mergeCars(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onMerged();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-series-1 bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-secondary">
          Merging <strong className="text-text-primary">{carLabel(sourceCar)}</strong>
          {targetCar ? (
            <>
              {" "}
              with <strong className="text-text-primary">{carLabel(targetCar)}</strong>
            </>
          ) : (
            " — check another car in the list below to pick who to merge with."
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCancel} className={actionButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={!targetCar || pending}
            className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Merging…" : "Merge these cars"}
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
                {buildCompareRows(sourceCar, targetCar).map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-text-secondary">{r.label}</td>
                    <td className={`py-1.5 pr-3 ${r.flagDiff ? "font-medium text-critical" : ""}`}>{r.a}</td>
                    <td className={`py-1.5 ${r.flagDiff ? "font-medium text-critical" : ""}`}>{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-text-secondary">Keep as the current listing</span>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`merge-keep-${sourceCar.id}`}
                  checked={keepId === sourceCar.id}
                  onChange={() => onKeepChange(sourceCar.id)}
                />
                {carLabel(sourceCar)}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`merge-keep-${sourceCar.id}`}
                  checked={keepId === targetCar.id}
                  onChange={() => onKeepChange(targetCar.id)}
                />
                {carLabel(targetCar)}
              </label>
            </div>
          </div>

          <p className="text-xs text-text-secondary">
            Both cars&apos; price and listing history carry over onto whichever one you keep — the other one&apos;s
            current link is archived too, then it&apos;s removed from your list.
          </p>
        </>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}
    </div>
  );
}
