"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AutocompleteInput } from "@/components/AutocompleteInput";
import { checkCarDuplicate, createCar, relistCar } from "@/lib/actions";
import { formatPrice } from "@/lib/format";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1";

type Duplicate = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  km: number;
  cylinders: number | null;
  spec: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  ad_placed_at: string | null;
  is_removed: boolean;
  latest_price: number | null;
  latest_currency: string | null;
};
type FieldOptions = { makes: string[]; specs: string[]; modelsByMake: Record<string, string[]> };

// What the user just typed into the form, captured at the moment a
// duplicate is detected — so the comparison table can show it next to the
// existing car's specs without re-reading the (uncontrolled) inputs later.
type NewEntry = {
  year: string;
  km: string;
  cylinders: string;
  spec: string;
  exterior_color: string;
  interior_color: string;
  ad_placed_at: string;
  price: string;
};

function normalizeCompare(v: string | number | null | undefined) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

// Everything here except dates/KM/price is independently pickable — see the
// "Use" dropdown per row below. Make/model aren't included: the duplicate
// match itself requires them to already be identical, so there's never
// anything to choose between for those two.
type PickableKey = "year" | "cylinders" | "spec" | "exterior_color" | "interior_color";

const PICKABLE_FIELDS: {
  key: PickableKey;
  label: string;
  existingValue: (d: Duplicate) => string;
  enteredValue: (e: NewEntry) => string;
  flag: boolean;
}[] = [
  { key: "year", label: "Year", existingValue: (d) => String(d.year), enteredValue: (e) => e.year, flag: true },
  {
    key: "cylinders",
    label: "Cylinders",
    existingValue: (d) => (d.cylinders != null ? String(d.cylinders) : ""),
    enteredValue: (e) => e.cylinders,
    flag: true,
  },
  { key: "spec", label: "Spec", existingValue: (d) => d.spec ?? "", enteredValue: (e) => e.spec, flag: true },
  {
    key: "exterior_color",
    label: "Ext. color",
    existingValue: (d) => d.exterior_color ?? "",
    enteredValue: (e) => e.exterior_color,
    flag: false,
  },
  {
    key: "interior_color",
    label: "Int. color",
    existingValue: (d) => d.interior_color ?? "",
    enteredValue: (e) => e.interior_color,
    flag: false,
  },
];

type InfoRow = { label: string; existing: string; entered: string };

// KM, ad-placement date, and price aren't pickable — they're expected to
// drift for a real re-listing (that's the point of relisting), and always
// come from what was just typed, not cherry-picked from the old record.
function buildInfoRows(duplicate: Duplicate, entry: NewEntry): InfoRow[] {
  function row(label: string, existingRaw: string | number | null, enteredRaw: string): InfoRow {
    return {
      label,
      existing: existingRaw != null && String(existingRaw) !== "" ? String(existingRaw) : "—",
      entered: enteredRaw !== "" ? enteredRaw : "—",
    };
  }

  const existingPrice =
    duplicate.latest_price != null ? formatPrice(duplicate.latest_price, duplicate.latest_currency ?? "AED") : null;
  const enteredPriceNum = Number(entry.price);
  const enteredPrice = entry.price && Number.isFinite(enteredPriceNum) ? formatPrice(enteredPriceNum, "AED") : "";

  return [
    row("KM", duplicate.km.toLocaleString(), entry.km ? Number(entry.km).toLocaleString() : ""),
    row("Ad placed", duplicate.ad_placed_at, entry.ad_placed_at),
    row("Price", existingPrice, enteredPrice),
  ];
}

export function NewCarForm({ url, options }: { url: string; options: FieldOptions }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [newEntry, setNewEntry] = useState<NewEntry | null>(null);
  // Per-field picks for the relist comparison table — defaults to what was
  // typed (unset), overridable to the existing car's value per field.
  const [fieldOverrides, setFieldOverrides] = useState<Partial<Record<PickableKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [spec, setSpec] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  // Narrow model suggestions to the chosen make; an unrecognized (or empty)
  // make falls back to every model seen across all cars.
  const modelOptions = useMemo(() => {
    const key = make.trim().toLowerCase();
    if (key && options.modelsByMake[key]) return options.modelsByMake[key];
    return Array.from(new Set(Object.values(options.modelsByMake).flat())).sort();
  }, [make, options]);

  function submitForReal(formData: FormData) {
    startTransition(async () => {
      const result = await createCar(null, formData);
      if (result?.error) setError(result.error);
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);

    setError(null);
    startTransition(async () => {
      const found = await checkCarDuplicate(formData);
      if (found) {
        setDuplicate(found);
        setNewEntry({
          year: String(formData.get("year") ?? ""),
          km: String(formData.get("km") ?? ""),
          cylinders: String(formData.get("cylinders") ?? ""),
          spec: String(formData.get("spec") ?? ""),
          exterior_color: String(formData.get("exterior_color") ?? ""),
          interior_color: String(formData.get("interior_color") ?? ""),
          ad_placed_at: String(formData.get("ad_placed_at") ?? ""),
          price: String(formData.get("price") ?? ""),
        });
        return;
      }
      submitForReal(formData);
    });
  }

  function handleConfirmAnyway() {
    if (!formRef.current) return;
    submitForReal(new FormData(formRef.current));
  }

  // Tracks this as a genuinely separate, independent car — own price
  // history, own removed/favorite status — but immediately links it to the
  // matched one, since it's the same physical car listed on another site at
  // the same time (unlike a relist, where one listing replaces another).
  function handleAlsoListed() {
    if (!formRef.current || !duplicate) return;
    const formData = new FormData(formRef.current);
    formData.set("also_listed_at_car_id", duplicate.id);
    submitForReal(formData);
  }

  // Merges into the matched car instead of creating a new one — its price
  // history carries over, and the old URL/ad date are archived so they stay
  // visible rather than silently overwritten.
  function handleRelist() {
    if (!formRef.current || !duplicate) return;
    const formData = new FormData(formRef.current);
    formData.set("existing_car_id", duplicate.id);
    // Anything explicitly picked as "Existing" overrides what was typed —
    // everything else submits as-typed, same as before this picker existed.
    for (const field of PICKABLE_FIELDS) {
      const override = fieldOverrides[field.key];
      if (override != null) formData.set(field.key, override);
    }
    setError(null);
    startTransition(async () => {
      const result = await relistCar(null, formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="url" value={url} />

      <Field id="make" label="Make">
        <AutocompleteInput
          id="make"
          name="make"
          required
          value={make}
          onChange={setMake}
          options={options.makes}
          className={inputClass}
          placeholder="BMW"
        />
      </Field>
      <Field id="model" label="Model">
        <AutocompleteInput
          id="model"
          name="model"
          required
          value={model}
          onChange={setModel}
          options={modelOptions}
          className={inputClass}
          placeholder="3 Series"
        />
      </Field>
      <Field id="year" label="Year">
        <input id="year" name="year" type="number" required min={1980} max={2100} className={inputClass} placeholder="2026" />
      </Field>
      <Field id="km" label="KM">
        <input id="km" name="km" type="number" min={0} className={inputClass} placeholder="15000" />
      </Field>
      <Field id="cylinders" label="Cylinders">
        <input id="cylinders" name="cylinders" type="number" min={1} max={16} className={inputClass} placeholder="6" />
      </Field>
      <Field id="spec" label="Spec">
        <AutocompleteInput
          id="spec"
          name="spec"
          value={spec}
          onChange={setSpec}
          options={options.specs}
          className={inputClass}
          placeholder="GCC Specs"
        />
      </Field>
      <Field id="exterior_color" label="Exterior color">
        <input id="exterior_color" name="exterior_color" className={inputClass} placeholder="Alpine White" />
      </Field>
      <Field id="interior_color" label="Interior color">
        <input id="interior_color" name="interior_color" className={inputClass} placeholder="Black" />
      </Field>
      <Field id="ad_placed_at" label="Ad placement date">
        <input id="ad_placed_at" name="ad_placed_at" type="date" className={inputClass} />
      </Field>
      <Field id="price" label="Price (AED)">
        <input id="price" name="price" type="number" min={0} step="1" required className={inputClass} placeholder="140000" />
      </Field>
      <Field id="recorded_at" label="Price date">
        <input id="recorded_at" name="recorded_at" type="date" defaultValue={today} className={inputClass} />
      </Field>

      <div className="sm:col-span-2 space-y-3">
        {error ? <p className="text-sm text-critical">{error}</p> : null}

        {duplicate ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
            <p>
              This looks like it might already be tracked as{" "}
              <Link href={`/?highlight=${duplicate.id}`} className="text-series-1 hover:underline">
                {duplicate.year} {duplicate.make} {duplicate.model}
              </Link>{" "}
              — same make/model/colors, KM {duplicate.km.toLocaleString()}
              {duplicate.is_removed ? ", currently marked removed" : ""}. Probably the same car
              re-listed under a new ad.
            </p>

            {newEntry ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-secondary">
                      <th className="pb-1 pr-3 font-medium"></th>
                      <th className="pb-1 pr-3 font-medium">Existing</th>
                      <th className="pb-1 pr-3 font-medium">New</th>
                      <th className="pb-1 font-medium">Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PICKABLE_FIELDS.map((field) => {
                      const existingRaw = field.existingValue(duplicate);
                      const enteredRaw = field.enteredValue(newEntry);
                      const current = fieldOverrides[field.key] ?? enteredRaw;
                      const differs = field.flag && normalizeCompare(existingRaw) !== normalizeCompare(enteredRaw);
                      return (
                        <tr key={field.key} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-3 text-text-secondary">{field.label}</td>
                          <td className={`py-1.5 pr-3 ${differs ? "font-medium text-critical" : ""}`}>
                            {existingRaw || "—"}
                          </td>
                          <td className={`py-1.5 pr-3 ${differs ? "font-medium text-critical" : ""}`}>
                            {enteredRaw || "—"}
                          </td>
                          <td className="py-1.5">
                            <select
                              value={current}
                              onChange={(e) =>
                                setFieldOverrides((prev) => ({ ...prev, [field.key]: e.target.value }))
                              }
                              className="rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-series-1"
                            >
                              <option value={enteredRaw}>{enteredRaw || "—"}</option>
                              <option value={existingRaw}>{existingRaw || "—"}</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                    {buildInfoRows(duplicate, newEntry).map((r) => (
                      <tr key={r.label} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3 text-text-secondary">{r.label}</td>
                        <td className="py-1.5 pr-3">{r.existing}</td>
                        <td className="py-1.5 pr-3">{r.entered}</td>
                        <td className="py-1.5 text-text-muted">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/?highlight=${duplicate.id}`}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
              >
                View existing car instead
              </Link>
              <button
                type="button"
                onClick={handleRelist}
                disabled={pending}
                title="Update the existing car with this new URL/details and keep its price history — the old URL is kept in its listing history."
                className="rounded-lg border border-series-1 px-4 py-2 text-sm font-medium text-series-1 hover:bg-highlight disabled:opacity-60"
              >
                {pending ? "Saving…" : "Same car, re-listed here (keep history)"}
              </button>
              <button
                type="button"
                onClick={handleAlsoListed}
                disabled={pending}
                title="Track this as its own car (own price history, own listing) and just connect it to the existing one — for when the same car is listed on more than one site at once. Unlink any time."
                className="rounded-lg border border-series-1 px-4 py-2 text-sm font-medium text-series-1 hover:bg-highlight disabled:opacity-60"
              >
                {pending ? "Adding…" : "Also listed elsewhere (link, don't merge)"}
              </button>
              <button
                type="button"
                onClick={handleConfirmAnyway}
                disabled={pending}
                className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {pending ? "Adding…" : "Add as a new car anyway"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Track this car"}
          </button>
        )}
      </div>
    </form>
  );
}
