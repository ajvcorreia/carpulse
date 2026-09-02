"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importData } from "@/lib/actions";

export default function ImportPage() {
  const [state, formAction, pending] = useActionState(importData, null);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
      >
        ← All cars
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Import</h1>
        <p className="text-sm text-text-secondary">
          Upload a CarPulse export JSON file. This only adds data — cars already
          tracked (matched by URL) and price points already logged (matched by date +
          price) are left untouched, never overwritten.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <input
          type="file"
          name="file"
          accept="application/json"
          required
          className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </form>

      {state && "error" in state && state.error ? <p className="text-sm text-critical">{state.error}</p> : null}
      {state && "success" in state && state.success ? <p className="text-sm text-good">{state.summary}</p> : null}
    </div>
  );
}
