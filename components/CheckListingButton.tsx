"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPriceInline, checkListingForUpdates, type ListingCheckResult } from "@/lib/actions";
import { formatPrice } from "@/lib/format";

// Experimental: asks the Scrapling sidecar to re-read the listing page and
// logs the price if it moved. Kept manual (one card at a time) until it's
// proven reliable enough across sites to run on a schedule.
export function CheckListingButton({ carId, className }: { carId: string; className: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ListingCheckResult | null>(null);
  const [checking, startChecking] = useTransition();
  const [saving, startSaving] = useTransition();

  function check() {
    setResult(null);
    startChecking(async () => {
      const r = await checkListingForUpdates(carId);
      setResult(r);
      if (r.kind === "updated" || (r.photosSaved ?? 0) > 0) router.refresh();
    });
  }

  function saveUnconfirmed(price: number) {
    const formData = new FormData();
    formData.set("car_id", carId);
    formData.set("price", String(price));
    startSaving(async () => {
      const r = await addPriceInline(null, formData);
      if (r?.error) {
        setResult({ kind: "error", message: r.error });
        return;
      }
      setResult({ kind: "updated", price, previous: null, currency: "AED" });
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={check}
        disabled={checking || saving}
        title="Fetch the listing page and log its current price if it changed"
        className={`${className} disabled:opacity-60`}
      >
        {checking ? "Checking listing…" : "Check listing for updates"}
      </button>
      {result ? <ResultMessage result={result} saving={saving} onSave={saveUnconfirmed} /> : null}
      {result?.photosSaved ? (
        <span className="text-sm text-text-secondary">
          Saved {result.photosSaved} photo{result.photosSaved === 1 ? "" : "s"}.
        </span>
      ) : null}
    </span>
  );
}

function ResultMessage({
  result,
  saving,
  onSave,
}: {
  result: ListingCheckResult;
  saving: boolean;
  onSave: (price: number) => void;
}) {
  switch (result.kind) {
    case "error":
      return <span className="text-sm text-critical">{result.message}</span>;
    case "gone":
      return (
        <span className="text-sm text-critical">
          {result.status === 404 || result.status === 410
            ? `Listing returned ${result.status} — it may have been removed.`
            : "The listing seems to be gone (the page says so, or redirects to a search page)."}
        </span>
      );
    case "no-price":
      return (
        <span className="text-sm text-text-secondary">
          Page loaded{result.title ? ` (“${result.title}”)` : ""}, but no price was found on it.
        </span>
      );
    case "unchanged":
      return (
        <span className="text-sm text-text-secondary">
          No change — still {formatPrice(result.price, result.currency)}.
        </span>
      );
    case "updated":
      return (
        <span className="text-sm text-text-primary">
          Logged new price {formatPrice(result.price, result.currency)}
          {result.previous != null ? ` (was ${formatPrice(result.previous, result.currency)})` : ""}.
        </span>
      );
    case "unconfirmed":
      return (
        <span className="text-sm text-text-secondary">
          Found {formatPrice(result.price, result.currency)}. {result.reason}{" "}
          {/* Saving only makes sense in AED — addPriceInline always records
              AED, so a foreign-currency hit is shown but not saveable. */}
          {result.currency === "AED" ? (
            <button
              type="button"
              onClick={() => onSave(result.price)}
              disabled={saving}
              className="text-series-1 hover:underline disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save it anyway"}
            </button>
          ) : null}
        </span>
      );
  }
}
