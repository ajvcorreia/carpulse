"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deletePrice, undoDeletePrice } from "@/lib/actions";
import { formatPrice } from "@/lib/format";
import type { PricePoint } from "@/lib/types";

type PendingUndo = { price: number; currency: string; recorded_at: string };

const UNDO_WINDOW_MS = 8000;

export function PriceHistoryList({ carId, points }: { carId: string; points: PricePoint[] }) {
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleDelete(priceId: string) {
    setError(null);
    const formData = new FormData();
    formData.set("price_id", priceId);
    formData.set("car_id", carId);

    startTransition(async () => {
      const result = await deletePrice(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.deleted) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setPendingUndo(result.deleted);
        timerRef.current = setTimeout(() => setPendingUndo(null), UNDO_WINDOW_MS);
      }
    });
  }

  function handleUndo() {
    if (!pendingUndo) return;
    setError(null);
    const formData = new FormData();
    formData.set("car_id", carId);
    formData.set("price", String(pendingUndo.price));
    formData.set("currency", pendingUndo.currency);
    formData.set("recorded_at", pendingUndo.recorded_at);

    startTransition(async () => {
      const result = await undoDeletePrice(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      setPendingUndo(null);
    });
  }

  if (points.length === 0 && !pendingUndo) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-text-secondary">Price history</h2>

      {error ? <p className="text-sm text-critical">{error}</p> : null}

      {pendingUndo ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
          <span className="text-text-secondary">
            Deleted {formatPrice(pendingUndo.price, pendingUndo.currency)} on {pendingUndo.recorded_at}.
          </span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={pending}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-series-1 hover:border-series-1 disabled:opacity-60"
          >
            Undo
          </button>
        </div>
      ) : null}

      {points.length > 0 ? (
        <table className="w-full max-w-sm text-sm">
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-2 text-text-secondary">{p.recorded_at}</td>
                <td className="tabular-nums py-2 text-right font-medium">{formatPrice(p.price, p.currency)}</td>
                <td className="py-2 pl-3 text-right">
                  {points.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      disabled={pending}
                      title="Delete this price entry"
                      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-critical hover:text-critical disabled:opacity-60"
                    >
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
