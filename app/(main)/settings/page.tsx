import Link from "next/link";
import { EmailSettingsForm, PhotoSettingsForm, ScanRunsPanel, ScanSettingsForm } from "@/components/SettingsForms";
import { getDb } from "@/lib/db/client";
import { countCarsWithPhotos } from "@/lib/photos";
import { getRecentScanRuns, isScanRunning } from "@/lib/scan";
import { getEmailSettings, getLastScheduledSlot, getPhotoSettings, getScanSettings } from "@/lib/settings";

// Reads the database on every request — never prerender at build time.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const scan = getScanSettings();
  const { smtpPassword, ...email } = getEmailSettings();
  const runs = getRecentScanRuns(10);
  const running = isScanRunning();
  const carsWithPhotos = countCarsWithPhotos();
  const totalCars = (getDb().prepare("select count(*) as n from cars").get() as { n: number }).n;
  const scannedCars = (
    getDb().prepare("select count(*) as n from cars where is_struck_out = 0").get() as { n: number }
  ).n;

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
        <ScanSettingsForm settings={scan} lastScheduledSlot={getLastScheduledSlot()} carCount={scannedCars} />
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
          <h2 className="font-medium">Listing photos</h2>
          <p className="text-sm text-text-secondary">
            Downloads a car&apos;s photos from its listing and keeps them here, so they&apos;re still around after the ad
            is taken down. Photos are saved the first time the listing is read with this on — when you add the car,
            click &ldquo;Check listing for updates&rdquo;, or a scan reaches it — and shown in the car&apos;s expanded
            view. {carsWithPhotos} of {totalCars} cars have photos.
          </p>
        </div>
        <PhotoSettingsForm settings={getPhotoSettings()} />
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
