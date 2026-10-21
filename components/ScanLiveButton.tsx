"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Brief = { running: boolean; checked: number; total: number };

// Dashboard shortcut to the live scan page, shown only while a scan runs.
// Polls, so it appears for a scheduled scan and goes away when one ends.
export function ScanLiveButton({ initial }: { initial: Brief }) {
  const [brief, setBrief] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (document.hidden) return;
      try {
        const res = await fetch("/scan/live?brief=1", { cache: "no-store" });
        if (res.ok && !cancelled) setBrief(await res.json());
      } catch {
        // Try again next time.
      }
    }
    const timer = setInterval(poll, brief.running ? 5000 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [brief.running]);

  if (!brief.running) return null;
  return (
    <Link
      href="/scan"
      className="inline-flex items-center gap-2 rounded-lg border border-series-1 bg-surface px-3 py-1.5 text-sm text-series-1 hover:bg-series-1 hover:text-white"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-good" />
      Scan running{brief.total ? ` · ${brief.checked}/${brief.total}` : ""} · Watch live
    </Link>
  );
}
