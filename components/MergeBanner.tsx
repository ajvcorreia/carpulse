"use client";

import { useState, useTransition } from "react";
import { mergeCars } from "@/lib/actions";
import { formatPrice } from "@/lib/format";
import type { CarWithPrices } from "@/lib/types";

const actionButtonClass =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary no-underline hover:border-series-1 hover:text-text-primary";
const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-series-1";

export function carLabel(car: CarWithPrices) {
  return `${car.year} ${car.make} ${car.model} — ${car.km != null ? `${car.km.toLocaleString()} km` : "no KM"}`;
}

function normalizeCompare(v: string | number | null | undefined) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

// The only fields that aren't independently pickable per-field — they stay
// tied to whichever car is kept as "the current listing" (see the radio
// below), since a date/km/price only makes sense in the context of one
// listing snapshot, not mixed piecemeal from two.
type FieldKey = "make" | "model" | "year" | "cylinders" | "spec" | "exterior_color" | "interior_color";

const PICKABLE_FIELDS: { key: FieldKey; label: string; get: (c: CarWithPrices) => string }[] = [
  { key: "make", label: "Make", get: (c) => c.make },
  { key: "model", label: "Model", get: (c) => c.model },
  { key: "year", label: "Year", get: (c) => String(c.year) },
  { key: "cylinders", label: "Cylinders", get: (c) => (c.cylinders != null ? String(c.cylinders) : "") },
  { key: "spec", label: "Spec", get: (c) => c.spec ?? "" },
  { key: "exterior_color", label: "Ext. color", get: (c) => c.exterior_color ?? "" },
  { key: "interior_color", label: "Int. color", get: (c) => c.interior_color ?? "" },
];

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
    row("KM", a.km?.toLocaleString() ?? null, b.km?.toLocaleString() ?? null),
    row("Ad placed", a.ad_placed_at, b.ad_placed_at),
    row(
      "Latest price",
      aLatest ? formatPrice(aLatest.price, aLatest.currency) : null,
      bLatest ? formatPrice(bLatest.price, bLatest.currency) : null
    ),
    row("Price points", a.price_history.length, b.price_history.length),
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
  // Only the fields the user has actually touched in a dropdown — anything
  // else falls back to whichever car "Keep as the current listing" points
  // at, so switching that radio still updates every field the user hasn't
  // deliberately overridden.
  const [fieldOverrides, setFieldOverrides] = useState<Partial<Record<FieldKey, string>>>({});

  function fieldValue(field: (typeof PICKABLE_FIELDS)[number]): string {
    if (fieldOverrides[field.key] != null) return fieldOverrides[field.key]!;
    const keepCar = keepId === sourceCar.id ? sourceCar : targetCar;
    return keepCar ? field.get(keepCar) : "";
  }

  function handleMerge() {
    if (!targetCar || !keepId) return;
    const mergeFromId = keepId === sourceCar.id ? targetCar.id : sourceCar.id;
    setError(null);
    const formData = new FormData();
    formData.set("keep_car_id", keepId);
    formData.set("merge_from_car_id", mergeFromId);
    for (const field of PICKABLE_FIELDS) {
      formData.set(field.key, fieldValue(field));
    }
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
          <div className="space-y-1">
            <span className="text-xs text-text-secondary">Keep as the current listing (link, KM, ad date, price)</span>
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th className="pb-1 pr-3 font-medium"></th>
                  <th className="pb-1 pr-3 font-medium">{carLabel(sourceCar)}</th>
                  <th className="pb-1 pr-3 font-medium">{carLabel(targetCar)}</th>
                  <th className="pb-1 font-medium">Use</th>
                </tr>
              </thead>
              <tbody>
                {PICKABLE_FIELDS.map((field) => {
                  const aValue = field.get(sourceCar);
                  const bValue = field.get(targetCar);
                  const current = fieldValue(field);
                  const differs = normalizeCompare(aValue) !== normalizeCompare(bValue);
                  return (
                    <tr key={field.key} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3 text-text-secondary">{field.label}</td>
                      <td className={`py-1.5 pr-3 ${differs ? "font-medium text-critical" : ""}`}>
                        {aValue || "—"}
                      </td>
                      <td className={`py-1.5 pr-3 ${differs ? "font-medium text-critical" : ""}`}>
                        {bValue || "—"}
                      </td>
                      <td className="py-1.5">
                        <select
                          value={current}
                          onChange={(e) =>
                            setFieldOverrides((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className={selectClass}
                        >
                          <option value={aValue}>{aValue || "—"}</option>
                          <option value={bValue}>{bValue || "—"}</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {buildInfoRows(sourceCar, targetCar).map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 text-text-secondary">{r.label}</td>
                    <td className="py-1.5 pr-3">{r.a}</td>
                    <td className="py-1.5 pr-3">{r.b}</td>
                    <td className="py-1.5 text-text-muted">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-text-secondary">
            Both cars&apos; price and listing history carry over regardless of what&apos;s picked above — the other
            car&apos;s current link is archived too, then it&apos;s removed from your list.
          </p>
        </>
      ) : null}

      {error ? <p className="text-sm text-critical">{error}</p> : null}
    </div>
  );
}
