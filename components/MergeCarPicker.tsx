"use client";

import { useMemo, useState, useTransition } from "react";
import { mergeCars } from "@/lib/actions";
import { formatPrice } from "@/lib/format";
import type { CarWithPrices } from "@/lib/types";

const actionButtonClass =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary no-underline hover:border-series-1 hover:text-text-primary";
const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-series-1";

function carLabel(car: CarWithPrices) {
  return `${car.year} ${car.make} ${car.model} — ${car.km != null ? `${car.km.toLocaleString()} km` : "no KM"}`;
}

function normalizeCompare(v: string | number | null | undefined) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

type CompareRow = { label: string; a: string; b: string; flagDiff: boolean };

// flagDiff only fires for fields that actually signal "maybe not the same
// car" — make/model/colors aren't included since two cars sharing this
// picker were both deliberately picked by the user, not fuzzy-matched.
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

// Lets the user merge the current car with another already-tracked one that
// turned out to be the same car. They pick which of the two keeps its
// url/details as the "current" record; nothing is discarded either way —
// the other car's price and listing history (and its own current url,
// archived) all carry over onto the kept car (see lib/actions.ts#mergeCars).
export function MergeCarPicker({
  car,
  allCars,
  onCancel,
  onMerged,
}: {
  car: CarWithPrices;
  allCars: CarWithPrices[];
  onCancel: () => void;
  onMerged: () => void;
}) {
  const [otherId, setOtherId] = useState("");
  // Defaults to keeping whichever of the two has the more recent
  // ad-placement date (falling back to created_at) once a car is picked —
  // overridable, since the user may know better than that heuristic.
  const [keepId, setKeepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const others = useMemo(
    () =>
      [...allCars]
        .filter((c) => c.id !== car.id)
        .sort((x, y) => `${x.make} ${x.model} ${x.year}`.localeCompare(`${y.make} ${y.model} ${y.year}`)),
    [allCars, car.id]
  );

  const other = otherId ? (allCars.find((c) => c.id === otherId) ?? null) : null;

  function pickOther(id: string) {
    setOtherId(id);
    setError(null);
    const picked = allCars.find((c) => c.id === id);
    if (!picked) {
      setKeepId(null);
      return;
    }
    const carDate = car.ad_placed_at ?? car.created_at;
    const otherDate = picked.ad_placed_at ?? picked.created_at;
    setKeepId(otherDate > carDate ? picked.id : car.id);
  }

  function handleMerge() {
    if (!other || !keepId) return;
    const mergeFromId = keepId === car.id ? other.id : car.id;
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
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="space-y-1">
        <label htmlFor={`merge-target-${car.id}`} className="text-xs text-text-secondary">
          Merge with
        </label>
        <select
          id={`merge-target-${car.id}`}
          value={otherId}
          onChange={(e) => pickOther(e.target.value)}
          className={`${selectClass} w-full max-w-md`}
        >
          <option value="">Choose a car…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {carLabel(c)}
            </option>
          ))}
        </select>
      </div>

      {other && keepId ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th className="pb-1 pr-3 font-medium"></th>
                  <th className="pb-1 pr-3 font-medium">This car</th>
                  <th className="pb-1 font-medium">{carLabel(other)}</th>
                </tr>
              </thead>
              <tbody>
                {buildCompareRows(car, other).map((r) => (
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
                  name={`keep-${car.id}`}
                  checked={keepId === car.id}
                  onChange={() => setKeepId(car.id)}
                />
                This car
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`keep-${car.id}`}
                  checked={keepId === other.id}
                  onChange={() => setKeepId(other.id)}
                />
                {carLabel(other)}
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

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCancel} className={actionButtonClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleMerge}
          disabled={!other || pending}
          className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Merging…" : "Merge these cars"}
        </button>
      </div>
    </div>
  );
}
