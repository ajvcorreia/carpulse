"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PriceChart } from "@/components/PriceChart";
import { PriceHistoryList } from "@/components/PriceHistoryList";
import { FavoriteToggle } from "@/components/FavoriteToggle";
import { InlineAddPriceForm } from "@/components/InlineAddPriceForm";
import { EditCarForm } from "@/components/EditCarForm";
import { markCarOpened, setCarRemovedFlag, setCarStruckOut } from "@/lib/actions";
import { daysOnDubizzle, formatPrice, totalDelta } from "@/lib/format";
import { claudeInsightsUrl } from "@/lib/claude";
import type { CarWithPrices, PricePoint } from "@/lib/types";

// How long a "you just opened this one" highlight stays live. Derived from
// the cars prop's last_opened_at (set server-side by markCarOpened).
const SELECTED_WINDOW_MS = 10 * 60 * 1000;

function mostRecentlyOpenedId(cars: CarWithPrices[]): string | null {
  const cutoff = Date.now() - SELECTED_WINDOW_MS;
  let bestId: string | null = null;
  let bestTime = -Infinity;
  for (const car of cars) {
    if (!car.last_opened_at) continue;
    const t = new Date(car.last_opened_at).getTime();
    if (t > cutoff && t > bestTime) {
      bestTime = t;
      bestId = car.id;
    }
  }
  return bestId;
}

type SortKey =
  | "favorite"
  | "removed"
  | "car"
  | "year"
  | "spec"
  | "exterior_color"
  | "interior_color"
  | "km"
  | "cylinders"
  | "ad_placed_at"
  | "days_on_dubizzle"
  | "price"
  | "change";
type SortDir = "asc" | "desc";

type Row = {
  car: CarWithPrices;
  points: PricePoint[];
  latest: PricePoint | null;
  delta: number | null;
  daysListed: number | null;
};

type FieldOptions = { makes: string[]; specs: string[]; modelsByMake: Record<string, string[]> };

type Filters = {
  make: string;
  model: string;
  year: string;
  spec: string;
  exteriorColor: string;
  interiorColor: string;
  kmMin: string;
  kmMax: string;
  priceMin: string;
  priceMax: string;
  hideRemoved: boolean;
  hideStruckOut: boolean;
  onlyPriceUpdates: boolean;
};

const DEFAULT_FILTERS: Filters = {
  make: "",
  model: "",
  year: "",
  spec: "",
  exteriorColor: "",
  interiorColor: "",
  kmMin: "",
  kmMax: "",
  priceMin: "",
  priceMax: "",
  hideRemoved: true,
  hideStruckOut: true,
  onlyPriceUpdates: false,
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
    case "favorite":
      // Favorites first on the first click (ascending) — the opposite of
      // the usual false-before-true boolean order, since "sort by
      // favorite" means "show me my favorites," not "show non-favorites."
      if (a.car.is_favorite === b.car.is_favorite) return 0;
      return a.car.is_favorite ? -1 : 1;
    case "removed":
      if (a.car.is_removed === b.car.is_removed) return 0;
      return a.car.is_removed ? 1 : -1;
    case "car":
      return `${a.car.make} ${a.car.model} ${a.car.year}`.localeCompare(
        `${b.car.make} ${b.car.model} ${b.car.year}`
      );
    case "year":
      return a.car.year - b.car.year;
    case "spec":
      return compareNullable(a.car.spec, b.car.spec, (x, y) => x.localeCompare(y));
    case "exterior_color":
      return compareNullable(a.car.exterior_color, b.car.exterior_color, (x, y) => x.localeCompare(y));
    case "interior_color":
      return compareNullable(a.car.interior_color, b.car.interior_color, (x, y) => x.localeCompare(y));
    case "km":
      return compareNullable(a.car.km, b.car.km, (x, y) => x - y);
    case "cylinders":
      return compareNullable(a.car.cylinders, b.car.cylinders, (x, y) => x - y);
    case "ad_placed_at":
      return compareNullable(a.car.ad_placed_at, b.car.ad_placed_at, (x, y) => x.localeCompare(y));
    case "days_on_dubizzle":
      return compareNullable(a.daysListed, b.daysListed, (x, y) => x - y);
    case "price":
      return compareNullable(a.latest?.price ?? null, b.latest?.price ?? null, (x, y) => x - y);
    case "change":
      return compareNullable(a.delta, b.delta, (x, y) => x - y);
  }
}

function matchesFilters(row: Row, filters: Filters): boolean {
  const { car, latest, points } = row;

  if (filters.hideRemoved && car.is_removed) return false;
  if (filters.hideStruckOut && car.is_struck_out) return false;
  // "Had a price update" means more than one recorded price point — the
  // first entry is the initial tracked price, not an update.
  if (filters.onlyPriceUpdates && points.length < 2) return false;

  if (filters.make && car.make !== filters.make) return false;
  if (filters.model && car.model !== filters.model) return false;
  if (filters.year && String(car.year) !== filters.year) return false;
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

// One-directional cascade, not mutual constraining: Make narrows Model
// narrows Year narrows Spec narrows Ext. color narrows Int. color, but never
// the reverse. Mutual constraining would let a downstream pick (e.g. a
// BMW-only model) shrink an upstream list (Make) down to the point where the
// option you actually want to switch to isn't even in the <select> anymore —
// a dead end the user can't click their way out of.
const FIELD_ORDER: (keyof Filters)[] = ["make", "model", "year", "spec", "exteriorColor", "interiorColor"];

function optionsFor<T>(
  rows: Row[],
  filters: Filters,
  forKey: (typeof FIELD_ORDER)[number],
  pick: (car: CarWithPrices) => T | null
): T[] {
  const scoped: Filters = { ...DEFAULT_FILTERS };
  scoped.hideRemoved = filters.hideRemoved;
  scoped.hideStruckOut = filters.hideStruckOut;
  scoped.onlyPriceUpdates = filters.onlyPriceUpdates;
  scoped.kmMin = filters.kmMin;
  scoped.kmMax = filters.kmMax;
  scoped.priceMin = filters.priceMin;
  scoped.priceMax = filters.priceMax;
  for (const key of FIELD_ORDER) {
    if (key === forKey) break;
    (scoped[key] as string) = filters[key] as string;
  }

  const seen = new Set<T>();
  for (const row of rows) {
    if (!matchesFilters(row, scoped)) continue;
    const value = pick(row.car);
    if (value != null) seen.add(value);
  }
  return Array.from(seen);
}

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "favorite", label: "Favorite" },
  { key: "removed", label: "Status" },
  { key: "car", label: "Car" },
  { key: "price", label: "Latest price" },
  { key: "year", label: "Year" },
  { key: "spec", label: "Spec" },
  { key: "exterior_color", label: "Ext. color" },
  { key: "interior_color", label: "Int. color" },
  { key: "km", label: "KM" },
  { key: "cylinders", label: "Cyl." },
  { key: "ad_placed_at", label: "Ad placed" },
  { key: "days_on_dubizzle", label: "Days on Dubizzle" },
  { key: "change", label: "Total change" },
];

const selectClass =
  "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-series-1";
const actionButtonClass =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary no-underline hover:border-series-1 hover:text-text-primary";

// Shared column template — used on both the header row and every card's
// collapsed row on sm+ screens, so values line up into real columns like a
// table even though each row is still a single expandable card.
const DESKTOP_GRID_COLS =
  "sm:grid-cols-[2.5rem_5rem_minmax(10rem,1fr)_6rem_3.5rem_6rem_5rem_5rem_5rem_3rem_6rem_4rem_7.5rem_1.5rem]";

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function CarsTable({
  cars,
  options,
  highlightId,
}: {
  cars: CarWithPrices[];
  options: FieldOptions;
  highlightId?: string;
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // Cards start collapsed to just make/model/price/year; expanding one shows
  // everything else in place — no separate detail page to navigate to.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  // Which row's listing was last opened — highlighted so it's obvious which
  // one you were looking at when you come back. Derived from the cars prop
  // (server data), not local/client storage.
  const selectedId = useMemo(() => mostRecentlyOpenedId(cars), [cars]);

  // Desktop opens the listing in a new tab; mobile navigates in place. On
  // iOS, target="_blank" hands dubizzle.com links off to the native app
  // instead of opening a browser tab at all (Universal Links) — desktop has
  // no such app to hand off to, so a new tab there is unambiguous and more
  // convenient (keep the dashboard open while comparing listings). Starts
  // false to match the server-rendered HTML, then set on mount — pointer
  // type isn't knowable server-side.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(mq.matches);
    function handleChange(e: MediaQueryListEvent) {
      setIsDesktop(e.matches);
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  // Coming from "?highlight=<id>" (just created a car, resolved a duplicate,
  // or added a price for an already-tracked one) — expand that card and
  // scroll to it, then drop the query param so a later refresh doesn't
  // re-trigger the scroll.
  useEffect(() => {
    if (!highlightId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedIds((ids) => new Set(ids).add(highlightId));
    document.getElementById(`car-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    router.replace("/");
  }, [highlightId, router]);

  const rows = useMemo<Row[]>(
    () =>
      cars.map((car) => {
        const points = car.price_history;
        return {
          car,
          points,
          latest: points[points.length - 1] ?? null,
          delta: totalDelta(points),
          daysListed: daysOnDubizzle(car.ad_placed_at),
        };
      }),
    [cars]
  );

  const makeOptions = useMemo(
    () => optionsFor(rows, filters, "make", (c) => c.make).sort(),
    [rows, filters]
  );
  const modelOptions = useMemo(
    () => optionsFor(rows, filters, "model", (c) => c.model).sort(),
    [rows, filters]
  );
  const yearOptions = useMemo(
    () => optionsFor(rows, filters, "year", (c) => c.year).sort((a, b) => b - a),
    [rows, filters]
  );
  const specOptions = useMemo(
    () => optionsFor(rows, filters, "spec", (c) => c.spec).sort(),
    [rows, filters]
  );
  const exteriorColorOptions = useMemo(
    () => optionsFor(rows, filters, "exteriorColor", (c) => c.exterior_color).sort(),
    [rows, filters]
  );
  const interiorColorOptions = useMemo(
    () => optionsFor(rows, filters, "interiorColor", (c) => c.interior_color).sort(),
    [rows, filters]
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
        setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(rawFilters) });
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

  // When one filter narrows another's option list (e.g. picking a Make that
  // excludes the currently selected Model), drop the now-invalid selection
  // rather than leaving a stale value the <select> can't actually display.
  useEffect(() => {
    const cleared: Partial<Filters> = {};
    if (filters.make && !makeOptions.includes(filters.make)) cleared.make = "";
    if (filters.model && !modelOptions.includes(filters.model)) cleared.model = "";
    if (filters.year && !yearOptions.some((y) => String(y) === filters.year)) cleared.year = "";
    if (filters.spec && !specOptions.includes(filters.spec)) cleared.spec = "";
    if (filters.exteriorColor && !exteriorColorOptions.includes(filters.exteriorColor)) cleared.exteriorColor = "";
    if (filters.interiorColor && !interiorColorOptions.includes(filters.interiorColor)) cleared.interiorColor = "";

    if (Object.keys(cleared).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilters((f) => {
        const next = { ...f, ...cleared };
        saveFilters(next);
        return next;
      });
    }
  }, [filters, makeOptions, modelOptions, yearOptions, specOptions, exteriorColorOptions, interiorColorOptions]);

  // Listing links navigate in this same tab on mobile (no target="_blank" —
  // iOS hands dubizzle.com URLs off to the native app when opened that way,
  // which skips our page/JS entirely, so there was never a reliable "new
  // tab" to track). Marking happens on mousedown/touchstart, before the
  // browser acts on the tap, so it's recorded even though the page is about
  // to navigate away.
  function markOpened(carId: string) {
    markCarOpened(carId).then(() => router.refresh());
  }

  function toggleRemoved(carId: string, removed: boolean) {
    setCarRemovedFlag(carId, removed).then(() => router.refresh());
  }

  // Only confirming the removed direction — undoing it back to active needs
  // no confirmation, since that's not the accidental-tap-prone one.
  // nextCardId auto-expands the next card so marking one removed (which
  // usually makes it vanish, via the hide-removed filter) doesn't leave the
  // user having to re-find their place in the list.
  function markRemovedWithConfirm(car: CarWithPrices, nextCardId?: string) {
    if (window.confirm(`Mark ${car.year} ${car.make} ${car.model} as removed from Dubizzle?`)) {
      toggleRemoved(car.id, true);
      if (nextCardId) {
        setExpandedIds((ids) => {
          const next = new Set(ids);
          next.delete(car.id);
          next.add(nextCardId);
          return next;
        });
      }
    }
  }

  function toggleExpanded(carId: string) {
    setExpandedIds((ids) => {
      const next = new Set(ids);
      if (next.has(carId)) next.delete(carId);
      else next.add(carId);
      return next;
    });
  }

  function startEditing(carId: string) {
    setEditingIds((ids) => new Set(ids).add(carId));
  }

  function stopEditing(carId: string) {
    setEditingIds((ids) => {
      const next = new Set(ids);
      next.delete(carId);
      return next;
    });
  }

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
    setFilters(DEFAULT_FILTERS);
    saveFilters(DEFAULT_FILTERS);
  }

  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const hasActiveSort = sortKey !== null;

  if (cars.length === 0) {
    return <p className="text-sm text-text-muted">No cars tracked yet — paste a listing URL above to add one.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <FilterField label="Make">
          <select value={filters.make} onChange={(e) => setFilter("make", e.target.value)} className={selectClass}>
            <option value="">All</option>
            {makeOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Model">
          <select value={filters.model} onChange={(e) => setFilter("model", e.target.value)} className={selectClass}>
            <option value="">All</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Year">
          <select value={filters.year} onChange={(e) => setFilter("year", e.target.value)} className={selectClass}>
            <option value="">All</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
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
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={filters.hideRemoved}
            onChange={(e) => setFilter("hideRemoved", e.target.checked)}
          />
          Hide removed ads
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={filters.hideStruckOut}
            onChange={(e) => setFilter("hideStruckOut", e.target.checked)}
          />
          Hide struck out cars
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={filters.onlyPriceUpdates}
            onChange={(e) => setFilter("onlyPriceUpdates", e.target.checked)}
          />
          Only cars with price updates
        </label>
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

      {/* Mobile: a "Sort by" select, since there's no header row to click. */}
      <div className="flex flex-wrap items-end gap-2 sm:hidden">
        <FilterField label="Sort by">
          <select
            value={sortKey ?? ""}
            onChange={(e) => (e.target.value ? toggleSort(e.target.value as SortKey) : resetSort())}
            className={selectClass}
          >
            <option value="">Default</option>
            {HEADERS.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </FilterField>
        {sortKey ? (
          <button
            type="button"
            onClick={() => toggleSort(sortKey)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
          >
            {sortDir === "asc" ? "▲ Ascending" : "▼ Descending"}
          </button>
        ) : null}
      </div>

      {/* Desktop: clickable column headers, same as the columns each card's
          collapsed row lines up into. */}
      <div className={`hidden sm:grid sm:items-center sm:gap-x-3 sm:px-3 ${DESKTOP_GRID_COLS}`}>
        {HEADERS.map((h) => (
          <button
            key={h.key}
            type="button"
            onClick={() => toggleSort(h.key)}
            className="flex items-center gap-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {h.label}
            {sortKey === h.key ? (
              <span className="text-series-1">{sortDir === "asc" ? "▲" : "▼"}</span>
            ) : null}
          </button>
        ))}
        <span />
      </div>

      {sortedRows.length === 0 ? (
        <p className="text-sm text-text-muted">No cars match these filters.</p>
      ) : (
        <div className="space-y-2" data-testid="car-list">
          {sortedRows.map(({ car, points, latest, delta, daysListed }, index) => {
            const isExpanded = expandedIds.has(car.id);
            const isEditing = editingIds.has(car.id);
            const nextCardId = sortedRows[index + 1]?.car.id;

            return (
              <div
                key={car.id}
                id={`car-${car.id}`}
                data-testid="car-card"
                className={`overflow-hidden rounded-lg border border-border ${
                  selectedId === car.id ? "bg-highlight" : ""
                }`}
              >
                <div
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 sm:grid sm:items-center ${DESKTOP_GRID_COLS} ${
                    isExpanded ? "bg-surface" : ""
                  }`}
                >
                  {/* Favorite — desktop only, its own cell, interactive
                      (stopPropagation so it doesn't also toggle the row). */}
                  <div className="hidden sm:flex sm:items-center" onClick={(e) => e.stopPropagation()}>
                    <FavoriteToggle
                      carId={car.id}
                      isFavorite={car.is_favorite}
                      className="text-lg leading-none text-series-1 hover:opacity-70 disabled:opacity-60"
                    />
                  </div>

                  {/* Status — desktop only, read-only (the toggle lives in
                      the expanded actions row). */}
                  <div className="hidden sm:block sm:text-sm sm:text-text-secondary">
                    {car.is_removed ? (
                      <span className="text-critical">Removed</span>
                    ) : car.is_struck_out ? (
                      <span className="text-critical">Struck out</span>
                    ) : (
                      "Active"
                    )}
                  </div>

                  {/* display:contents on sm+ so these become direct grid
                      items of the row above, lining up under the header —
                      the button itself stays the single click target for
                      expand/collapse, on mobile and desktop alike. */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(car.id)}
                    aria-expanded={isExpanded}
                    className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left sm:contents"
                  >
                    <span
                      className={`flex-1 sm:flex-none ${isExpanded ? "text-base font-semibold" : "font-medium"} ${
                        car.is_removed || car.is_struck_out ? "text-text-muted line-through" : "text-text-primary"
                      }`}
                    >
                      {car.make} {car.model}
                    </span>
                    <span className="tabular-nums text-sm font-medium">
                      {latest ? formatPrice(latest.price, latest.currency) : "—"}
                    </span>
                    <span className="tabular-nums text-sm text-text-secondary">{car.year}</span>

                    {/* Desktop only — the rest of the columns. */}
                    <span className="hidden sm:block sm:text-sm sm:text-text-secondary">{car.spec ?? "—"}</span>
                    <span className="hidden sm:block sm:text-sm sm:text-text-secondary">
                      {car.exterior_color ?? "—"}
                    </span>
                    <span className="hidden sm:block sm:text-sm sm:text-text-secondary">
                      {car.interior_color ?? "—"}
                    </span>
                    <span className="hidden sm:tabular-nums sm:block sm:text-sm sm:text-text-secondary">
                      {car.km != null ? car.km.toLocaleString() : "—"}
                    </span>
                    <span className="hidden sm:tabular-nums sm:block sm:text-sm sm:text-text-secondary">
                      {car.cylinders ?? "—"}
                    </span>
                    <span className="hidden sm:block sm:text-sm sm:text-text-secondary">
                      {car.ad_placed_at ?? "—"}
                    </span>
                    <span className="hidden sm:tabular-nums sm:block sm:text-sm sm:text-text-secondary">
                      {daysListed ?? "—"}
                    </span>
                    <span className="hidden sm:tabular-nums sm:block sm:text-sm">
                      {delta == null ? (
                        "—"
                      ) : delta === 0 ? (
                        "No change"
                      ) : delta < 0 ? (
                        <span className="text-good">▼ {formatPrice(Math.abs(delta), latest!.currency)}</span>
                      ) : (
                        <span className="text-critical">▲ {formatPrice(delta, latest!.currency)}</span>
                      )}
                    </span>

                    <span className="text-text-muted">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                </div>

                {isExpanded ? (
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    {isEditing ? (
                      <EditCarForm
                        car={car}
                        options={options}
                        onSaved={() => {
                          stopEditing(car.id);
                          router.refresh();
                        }}
                        onCancel={() => stopEditing(car.id)}
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => startEditing(car.id)} className={actionButtonClass}>
                            Edit details
                          </button>
                          {car.is_removed ? (
                            <button
                              type="button"
                              onClick={() => toggleRemoved(car.id, false)}
                              className={actionButtonClass}
                            >
                              Mark active
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => markRemovedWithConfirm(car, nextCardId)}
                              className={actionButtonClass}
                            >
                              Mark removed
                            </button>
                          )}
                          <FavoriteToggle
                            carId={car.id}
                            isFavorite={car.is_favorite}
                            className="inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xl leading-none text-series-1 hover:opacity-70 disabled:opacity-60"
                          />
                          <a
                            href={car.url}
                            target={isDesktop ? "_blank" : undefined}
                            rel={isDesktop ? "noreferrer" : undefined}
                            onMouseDown={() => markOpened(car.id)}
                            onTouchStart={() => markOpened(car.id)}
                            className={`${actionButtonClass} text-series-1`}
                          >
                            Open listing{isDesktop ? " ↗" : ""}
                          </a>
                          <a
                            href={claudeInsightsUrl(car, latest ? formatPrice(latest.price, latest.currency) : null)}
                            target="_blank"
                            rel="noreferrer"
                            title="Ask Claude about this engine/trim: reliability, common issues, maintenance costs"
                            className={actionButtonClass}
                          >
                            Ask Claude
                          </a>
                        </div>

                        <div className="flex flex-wrap items-end gap-2">
                          {car.is_struck_out ? (
                            <form action={setCarStruckOut} className="flex items-end gap-2">
                              <input type="hidden" name="car_id" value={car.id} />
                              <input type="hidden" name="struck_out" value="false" />
                              <button type="submit" className={actionButtonClass}>
                                Remove strike-out
                              </button>
                            </form>
                          ) : (
                            <form action={setCarStruckOut} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="car_id" value={car.id} />
                              <input type="hidden" name="struck_out" value="true" />
                              <div className="space-y-1">
                                <label htmlFor={`reason-${car.id}`} className="text-xs text-text-secondary">
                                  Strike-out reason (optional)
                                </label>
                                <input
                                  id={`reason-${car.id}`}
                                  name="reason"
                                  placeholder="e.g. incorrect spec"
                                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-series-1"
                                />
                              </div>
                              <button
                                type="submit"
                                onClick={(e) => {
                                  if (
                                    !window.confirm(
                                      `Strike out ${car.year} ${car.make} ${car.model}? It'll be hidden by default, same as a removed ad.`
                                    )
                                  ) {
                                    e.preventDefault();
                                  }
                                }}
                                className={actionButtonClass}
                              >
                                Strike out this car
                              </button>
                            </form>
                          )}
                        </div>

                        {car.is_removed ? <p className="text-sm text-critical">Removed from Dubizzle</p> : null}
                        {car.is_struck_out ? (
                          <p className="text-sm text-critical">
                            Struck out{car.strike_out_reason ? `: ${car.strike_out_reason}` : ""}
                          </p>
                        ) : null}

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                          <div>
                            <dt className="text-text-secondary">Spec</dt>
                            <dd>{car.spec ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Ext. color</dt>
                            <dd>{car.exterior_color ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Int. color</dt>
                            <dd>{car.interior_color ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">KM</dt>
                            <dd className="tabular-nums">{car.km != null ? car.km.toLocaleString() : "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Cylinders</dt>
                            <dd className="tabular-nums">{car.cylinders ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Ad placed</dt>
                            <dd>{car.ad_placed_at ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Days on Dubizzle</dt>
                            <dd className="tabular-nums">{daysListed ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Total change</dt>
                            <dd className="tabular-nums">
                              {delta == null ? (
                                "—"
                              ) : delta === 0 ? (
                                "No change"
                              ) : delta < 0 ? (
                                <span className="text-good">
                                  ▼ {formatPrice(Math.abs(delta), latest!.currency)}
                                </span>
                              ) : (
                                <span className="text-critical">▲ {formatPrice(delta, latest!.currency)}</span>
                              )}
                            </dd>
                          </div>
                        </dl>

                        <PriceChart points={points} />

                        <div className="space-y-1">
                          <h3 className="text-xs font-medium text-text-secondary">Add a new price update</h3>
                          <InlineAddPriceForm carId={car.id} />
                        </div>

                        <PriceHistoryList carId={car.id} points={points} />
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
