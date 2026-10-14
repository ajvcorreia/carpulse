import Link from "next/link";
import { EmailSettingsForm, ScanRunsPanel, ScanSettingsForm } from "@/components/SettingsForms";
import { getRecentScanRuns, isScanRunning } from "@/lib/scan";
import { getEmailSettings, getLastScheduledDate, getScanSettings } from "@/lib/settings";

// Reads the database on every request — never prerender at build time.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const scan = getScanSettings();
  const { smtpPassword, ...email } = getEmailSettings();
  const runs = getRecentScanRuns(10);
  const running = isScanRunning();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-series-1 hover:text-text-primary"
      >
        ← All cars
      </Link>
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-medium">Automatic scan</h2>
          <p className="text-sm text-text-secondary">
            Checks every car&apos;s listing (struck-out cars are skipped): logs price changes, marks cars removed when
            their listing is gone, and marks removed cars active again when their listing is back. Cars are checked one
            at a time with a random pause in between, so a full scan of many cars takes a while.
          </p>
        </div>
        <ScanSettingsForm settings={scan} lastScheduledDate={getLastScheduledDate()} />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-medium">Scan runs</h2>
          <p className="text-sm text-text-secondary">Run a scan now, or see what recent scans changed.</p>
        </div>
        <ScanRunsPanel runs={runs} running={running} timezone={scan.timezone} />
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-medium">Email updates</h2>
          <p className="text-sm text-text-secondary">
            Sends a summary after each scan. Works with any SMTP server — for Gmail, use smtp.gmail.com, port 587, and
            an app password.
          </p>
        </div>
        <EmailSettingsForm settings={email} hasPassword={smtpPassword !== ""} />
      </section>
    </div>
  );
}
