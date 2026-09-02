"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { checkCarDuplicate, createCar } from "@/lib/actions";

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

type Duplicate = { id: string; url: string; make: string; model: string; year: number; km: number };
type FieldOptions = { makes: string[]; specs: string[]; modelsByMake: Record<string, string[]> };

export function NewCarForm({ url, options }: { url: string; options: FieldOptions }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [make, setMake] = useState("");
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
        return;
      }
      submitForReal(formData);
    });
  }

  function handleConfirmAnyway() {
    if (!formRef.current) return;
    submitForReal(new FormData(formRef.current));
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="url" value={url} />

      <Field id="make" label="Make">
        <input
          id="make"
          name="make"
          list="makes-options"
          required
          value={make}
          onChange={(e) => setMake(e.target.value)}
          className={inputClass}
          placeholder="BMW"
        />
      </Field>
      <Field id="model" label="Model">
        <input id="model" name="model" list="models-options" required className={inputClass} placeholder="3 Series" />
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
        <input id="spec" name="spec" list="specs-options" className={inputClass} placeholder="GCC Specs" />
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
              <Link href={`/car/${duplicate.id}`} className="text-series-1 hover:underline">
                {duplicate.year} {duplicate.make} {duplicate.model}
              </Link>{" "}
              — same make/model/colors, KM {duplicate.km.toLocaleString()}. Probably the same car
              re-listed under a new ad.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/car/${duplicate.id}`}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
              >
                View existing car instead
              </Link>
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

      <datalist id="makes-options">
        {options.makes.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="models-options">
        {modelOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="specs-options">
        {options.specs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </form>
  );
}
