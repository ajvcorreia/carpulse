"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPriceInline } from "@/lib/actions";

// Mirrors AddPriceForm, but calls the non-redirecting action and refreshes
// in place — used from the dashboard's mobile card, where navigating to the
// detail page just to log a price would defeat the point of doing it inline.
export function InlineAddPriceForm({ carId }: { carId: string }) {
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [recordedAt, setRecordedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("car_id", carId);
    formData.set("price", price);
    formData.set("recorded_at", recordedAt);

    startTransition(async () => {
      const result = await addPriceInline(null, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setPrice("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor={`price-${carId}`} className="text-xs text-text-secondary">
          Price (AED)
        </label>
        <input
          id={`price-${carId}`}
          type="number"
          min={0}
          step="1"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-series-1"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`date-${carId}`} className="text-xs text-text-secondary">
          Date
        </label>
        <input
          id={`date-${carId}`}
          type="date"
          value={recordedAt}
          onChange={(e) => setRecordedAt(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-series-1"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-series-1 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add price"}
      </button>
      {error ? <p className="w-full text-sm text-critical">{error}</p> : null}
    </form>
  );
}
