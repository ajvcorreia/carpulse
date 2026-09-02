"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AutocompleteInput } from "@/components/AutocompleteInput";
import { updateCar } from "@/lib/actions";
import type { Car } from "@/lib/types";

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

type FieldOptions = { makes: string[]; specs: string[]; modelsByMake: Record<string, string[]> };

export function EditCarForm({
  car,
  options,
  onSaved,
  onCancel,
}: {
  car: Car;
  options: FieldOptions;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [make, setMake] = useState(car.make);
  const [model, setModel] = useState(car.model);
  const [spec, setSpec] = useState(car.spec ?? "");

  // Narrow model suggestions to the chosen make; an unrecognized (or empty)
  // make falls back to every model seen across all cars.
  const modelOptions = useMemo(() => {
    const key = make.trim().toLowerCase();
    if (key && options.modelsByMake[key]) return options.modelsByMake[key];
    return Array.from(new Set(Object.values(options.modelsByMake).flat())).sort();
  }, [make, options]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);

    setError(null);
    startTransition(async () => {
      const result = await updateCar(null, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onSaved?.();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="car_id" value={car.id} />

      <Field id={`url-${car.id}`} label="Listing URL">
        <input id={`url-${car.id}`} name="url" type="url" required defaultValue={car.url} className={inputClass} />
      </Field>
      <div className="hidden sm:block" />
      <Field id={`make-${car.id}`} label="Make">
        <AutocompleteInput
          id={`make-${car.id}`}
          name="make"
          required
          value={make}
          onChange={setMake}
          options={options.makes}
          className={inputClass}
        />
      </Field>
      <Field id={`model-${car.id}`} label="Model">
        <AutocompleteInput
          id={`model-${car.id}`}
          name="model"
          required
          value={model}
          onChange={setModel}
          options={modelOptions}
          className={inputClass}
        />
      </Field>
      <Field id={`year-${car.id}`} label="Year">
        <input
          id={`year-${car.id}`}
          name="year"
          type="number"
          required
          min={1980}
          max={2100}
          defaultValue={car.year}
          className={inputClass}
        />
      </Field>
      <Field id={`km-${car.id}`} label="KM">
        <input id={`km-${car.id}`} name="km" type="number" min={0} defaultValue={car.km ?? ""} className={inputClass} />
      </Field>
      <Field id={`cylinders-${car.id}`} label="Cylinders">
        <input
          id={`cylinders-${car.id}`}
          name="cylinders"
          type="number"
          min={1}
          max={16}
          defaultValue={car.cylinders ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id={`spec-${car.id}`} label="Spec">
        <AutocompleteInput
          id={`spec-${car.id}`}
          name="spec"
          value={spec}
          onChange={setSpec}
          options={options.specs}
          className={inputClass}
        />
      </Field>
      <Field id={`exterior_color-${car.id}`} label="Exterior color">
        <input
          id={`exterior_color-${car.id}`}
          name="exterior_color"
          defaultValue={car.exterior_color ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id={`interior_color-${car.id}`} label="Interior color">
        <input
          id={`interior_color-${car.id}`}
          name="interior_color"
          defaultValue={car.interior_color ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id={`ad_placed_at-${car.id}`} label="Ad placement date">
        <input
          id={`ad_placed_at-${car.id}`}
          name="ad_placed_at"
          type="date"
          defaultValue={car.ad_placed_at ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="sm:col-span-2 space-y-3">
        {error ? <p className="text-sm text-critical">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
