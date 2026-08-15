"use client";

import { useActionState } from "react";
import { addPrice } from "@/lib/actions";

export function AddPriceForm({ carId }: { carId: string }) {
  const [state, formAction, pending] = useActionState(addPrice, null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="car_id" value={carId} />
      <div className="space-y-1">
        <label htmlFor="price" className="text-xs text-text-secondary">
          Price (AED)
        </label>
        <input
          id="price"
          name="price"
          type="number"
          min={0}
          step="1"
          required
          className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="recorded_at" className="text-xs text-text-secondary">
          Date
        </label>
        <input
          id="recorded_at"
          name="recorded_at"
          type="date"
          defaultValue={today}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-series-1"
        />
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {pending ? "Saving…" : "Add price"}
      </button>
      {state?.error ? <p className="w-full text-sm text-critical">{state.error}</p> : null}
    </form>
  );
}
