"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/Sparkline";
import { formatPrice, latestDelta } from "@/lib/format";
import type { CarWithPrices, PricePoint } from "@/lib/types";

type SortKey = "car" | "spec" | "exterior_color" | "interior_color" | "km" | "ad_placed_at" | "price" | "change";
type SortDir = "asc" | "desc";

type Row = {
  car: CarWithPrices;
  points: PricePoint[];
  latest: PricePoint | null;
  delta: number | null;
};

type Filters = {
  search: string;
  spec: string;
  exteriorColor: string;
  interiorColor: string;
  kmMin: string;
  kmMax: string;
  priceMin: string;
  priceMax: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  spec: "",
  exteriorColor: "",
  interiorColor: "",
  kmMin: "",
  kmMax: "",
  priceMin: "",
  priceMax: "",
};

const FILTERS_STORAGE_KEY = "dubbizlewatch:filters";
const SORT_STORAGE_KEY = "dubbizlewatch:sort";

function saveFilters(filters: Filters) {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage unavailable (private browsing, etc.) — remembering is best-effort.
  }
}

function saveSort(key: SortKey | null, dir: SortDir) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key, dir }));
  } catch {
    // ignore
  }
}

function compareNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b);
}

function compareRows(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "car":
      return `${a.car.make} ${a.car.model} ${a.car.year}`.localeCompare(
        `${b.car.make} ${b.car.model} ${b.car.year}`
      );
    case "spec":
      return compareNullable(a.car.spec, b.car.spec, (x, y) => x.localeCompare(y));
    case "exterior_color":
      return compareNullable(a.car.exterior_color, b.car.exterior_color, (x, y) => x.localeCompare(y));
    case "interior_color":
      return compareNullable(a.car.interior_color, b.car.interior_color, (x, y) => x.localeCompare(y));
    case "km":
      return compareNullable(a.car.km, b.car.km, (x, y) => x - y);
    case "ad_placed_at":
      return compareNullable(a.car.ad_placed_at, b.car.ad_placed_at, (x, y) => x.localeCompare(y));
    case "price":
      return compareNullable(a.latest?.price ?? null, b.latest?.price ?? null, (x, y) => x - y);
    case "change":
      return compareNullable(a.delta, b.delta, (x, y) => x - y);
  }
}

function matchesFilters(row: Row, filters: Filters): boolean {
  const { car, latest } = row;

  if (filters.search.trim()) {
    const needle = filters.search.trim().toLowerCase();
    const haystack = `${car.make} ${car.model} ${car.year}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (filters.spec && car.spec !== filters.spec) return false;
  if (filters.exteriorColor && car.exterior_color !== filters.exteriorColor) return false;
  if (filters.interiorColor && car.interior_color !== filters.interiorColor) return false;

  if (filters.kmMin && (car.km == null || car.km < Number(filters.kmMin))) return false;
  if (filters.kmMax && (car.km == null || car.km > Number(filters.kmMax))) return false;

  const price = latest?.price ?? null;
  if (filters.priceMin && (price == null || price < Number(filters.priceMin))) return false;
  if (filters.priceMax && (price == null || price > Number(filters.priceMax))) return false;

  return true;
}

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "car", label: "Car" },
  { key: "spec", label: "Spec" },
  { key: "exterior_color", label: "Ext. color" },
  { key: "interior_color", label: "Int. color" },
  { key: "km", label: "KM" },
  { key: "ad_placed_at", label: "Ad placed" },
  { key: "price", label: "Latest price" },
  { key: "change", label: "Change" },
];

const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-series-1";

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function CarsTable({ cars }: { cars: CarWithPrices[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const rows = useMemo<Row[]>(
    () =>
      cars.map((car) => {
        const points = car.price_history;
        return {
          car,
          points,
          latest: points[points.length - 1] ?? null,
          delta: latestDelta(points),
        };
      }),
    [cars]
  );

  const specOptions = useMemo(
    () => Array.from(new Set(cars.map((c) => c.spec).filter((v): v is string => !!v))).sort(),
    [cars]
  );
  const exteriorColorOptions = useMemo(
    () => Array.from(new Set(cars.map((c) => c.exterior_color).filter((v): v is string => !!v))).sort(),
    [cars]
  );
  const interiorColorOptions = useMemo(
    () => Array.from(new Set(cars.map((c) => c.interior_color).filter((v): v is string => !!v))).sort(),
    [cars]
  );

  const filteredRows = useMemo(() => rows.filter((r) => matchesFilters(r, filters)), [rows, filters]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredRows].sort((a, b) => compareRows(a, b, sortKey) * dir);
  }, [filteredRows, sortKey, sortDir]);

  // Restore remembered filters/sort after mount — deliberately not in the
  // initial useState (would read localStorage during SSR/hydration and
  // mismatch the server-rendered HTML). This is a one-shot sync from an
  // external store (localStorage) on mount, one of the documented valid
  // uses of an effect, even though the lint heuristic can't tell that apart
  // from the discouraged "derive state from props" pattern.
  useEffect(() => {
    try {
      const rawFilters = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (rawFilters) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilters({ ...EMPTY_FILTERS, ...JSON.parse(rawFilters) });
      }
    } catch {
      // ignore malformed/unavailable storage
    }
    try {
      const rawSort = localStorage.getItem(SORT_STORAGE_KEY);
      if (rawSort) {
        const parsed = JSON.parse(rawSort) as { key: SortKey | null; dir: SortDir };
        setSortKey(parsed.key ?? null);
        setSortDir(parsed.dir ?? "asc");
      }
    } catch {
      // ignore
    }
  }, []);

  function toggleSort(key: SortKey) {
    const nextDir: SortDir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    setSortKey(key);
    setSortDir(nextDir);
    saveSort(key, nextDir);
  }

  function resetSort() {
    setSortKey(null);
    setSortDir("asc");
    saveSort(null, "asc");
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => {
      const next = { ...f, [key]: value };
      saveFilters(next);
      return next;
    });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    saveFilters(EMPTY_FILTERS);
  }

  const hasActiveFilters = Object.values(filters).some((v) => v !== "");
  const hasActiveSort = sortKey !== null;

  if (cars.length === 0) {
    return <p className="text-sm text-text-muted">No cars tracked yet — paste a listing URL above to add one.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <FilterField label="Search">
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Make, model, year…"
            className={`${selectClass} w-40`}
          />
        </FilterField>
        <FilterField label="Spec">
          <select value={filters.spec} onChange={(e) => setFilter("spec", e.target.value)} className={selectClass}>
            <option value="">All</option>
            {specOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Ext. color">
          <select
            value={filters.exteriorColor}
            onChange={(e) => setFilter("exteriorColor", e.target.value)}
            className={selectClass}
          >
            <option value="">All</option>
            {exteriorColorOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Int. color">
          <select
            value={filters.interiorColor}
            onChange={(e) => setFilter("interiorColor", e.target.value)}
            className={selectClass}
          >
            <option value="">All</option>
            {interiorColorOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="KM min">
          <input
            type="number"
            min={0}
            value={filters.kmMin}
            onChange={(e) => setFilter("kmMin", e.target.value)}
            className={`${selectClass} w-24`}
          />
        </FilterField>
        <FilterField label="KM max">
          <input
            type="number"
            min={0}
            value={filters.kmMax}
            onChange={(e) => setFilter("kmMax", e.target.value)}
            className={`${selectClass} w-24`}
          />
        </FilterField>
        <FilterField label="Price min">
          <input
            type="number"
            min={0}
            value={filters.priceMin}
            onChange={(e) => setFilter("priceMin", e.target.value)}
            className={`${selectClass} w-28`}
          />
        </FilterField>
        <FilterField label="Price max">
          <input
            type="number"
            min={0}
            value={filters.priceMax}
            onChange={(e) => setFilter("priceMax", e.target.value)}
            className={`${selectClass} w-28`}
          />
        </FilterField>
        {hasActiveFilters ? (
          <button type="button" onClick={resetFilters} className="text-sm text-series-1 hover:underline">
            Reset filters
          </button>
        ) : null}
        {hasActiveSort ? (
          <button type="button" onClick={resetSort} className="text-sm text-series-1 hover:underline">
            Reset sort
          </button>
        ) : null}
      </div>

      {sortedRows.length === 0 ? (
        <p className="text-sm text-text-muted">No cars match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                {HEADERS.map((h) => (
                  <th key={h.key} className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(h.key)}
                      className="inline-flex items-center gap-1 hover:text-text-primary"
                    >
                      {h.label}
                      {sortKey === h.key ? (
                        <span className="text-xs text-series-1">{sortDir === "asc" ? "▲" : "▼"}</span>
                      ) : null}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(({ car, points, latest, delta }) => (
                <tr
                  key={car.id}
                  className={`border-b border-border last:border-0 ${
                    car.is_removed ? "opacity-50 line-through" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <a
                        href={car.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the Dubizzle listing in a new tab"
                        className="font-medium text-text-primary hover:underline"
                      >
                        {car.year} {car.make} {car.model} ↗
                      </a>
                      <Link
                        href={`/car/${car.id}`}
                        title="View price history"
                        className="text-xs text-text-secondary no-underline hover:text-series-1 hover:underline"
                      >
                        Details
                      </Link>
                      {car.is_removed ? (
                        <span className="rounded-full bg-critical/10 px-1.5 py-0.5 text-xs font-medium text-critical no-underline">
                          Removed
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{car.spec ?? "—"}</td>
                  <td className="px-3 py-2 text-text-secondary">{car.exterior_color ?? "—"}</td>
                  <td className="px-3 py-2 text-text-secondary">{car.interior_color ?? "—"}</td>
                  <td className="tabular-nums px-3 py-2 text-text-secondary">
                    {car.km != null ? car.km.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{car.ad_placed_at ?? "—"}</td>
                  <td className="tabular-nums px-3 py-2 font-medium">
                    {latest ? formatPrice(latest.price, latest.currency) : "—"}
                  </td>
                  <td className="tabular-nums px-3 py-2">
                    {delta == null ? (
                      <span className="text-text-muted">—</span>
                    ) : delta === 0 ? (
                      <span className="text-text-secondary">No change</span>
                    ) : delta < 0 ? (
                      <span className="text-good">▼ {formatPrice(Math.abs(delta), latest!.currency)}</span>
                    ) : (
                      <span className="text-critical">▲ {formatPrice(delta, latest!.currency)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline points={points} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
