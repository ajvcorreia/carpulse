import Link from "next/link";
import { LiveScanView } from "@/components/LiveScanView";
import { getLiveScan } from "@/lib/scan";
import { getScanSettings } from "@/lib/settings";

// Reads in-memory scan state on every request — never prerender at build time.
export const dynamic = "force-dynamic";

export default function LiveScanPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Live scan</h1>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
        >
          Scan settings &amp; history
        </Link>
      </div>
      <LiveScanView initial={getLiveScan()} timezone={getScanSettings().timezone} />
    </div>
  );
}
