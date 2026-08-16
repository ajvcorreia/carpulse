"use client";

import { useRef, useState, useTransition } from "react";
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

export function EditCarForm({ car }: { car: Car }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);

    setError(null);
    startTransition(async () => {
      const result = await updateCar(null, formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="car_id" value={car.id} />

      <Field id="url" label="Listing URL">
        <input id="url" name="url" type="url" required defaultValue={car.url} className={inputClass} />
      </Field>
      <div className="hidden sm:block" />
      <Field id="make" label="Make">
        <input id="make" name="make" required defaultValue={car.make} className={inputClass} />
      </Field>
      <Field id="model" label="Model">
        <input id="model" name="model" required defaultValue={car.model} className={inputClass} />
      </Field>
      <Field id="year" label="Year">
        <input
          id="year"
          name="year"
          type="number"
          required
          min={1980}
          max={2100}
          defaultValue={car.year}
          className={inputClass}
        />
      </Field>
      <Field id="km" label="KM">
        <input id="km" name="km" type="number" min={0} defaultValue={car.km ?? ""} className={inputClass} />
      </Field>
      <Field id="cylinders" label="Cylinders">
        <input
          id="cylinders"
          name="cylinders"
          type="number"
          min={1}
          max={16}
          defaultValue={car.cylinders ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id="spec" label="Spec">
        <input id="spec" name="spec" defaultValue={car.spec ?? ""} className={inputClass} />
      </Field>
      <Field id="exterior_color" label="Exterior color">
        <input
          id="exterior_color"
          name="exterior_color"
          defaultValue={car.exterior_color ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id="interior_color" label="Interior color">
        <input
          id="interior_color"
          name="interior_color"
          defaultValue={car.interior_color ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id="ad_placed_at" label="Ad placement date">
        <input
          id="ad_placed_at"
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
        </div>
      </div>
    </form>
  );
}
