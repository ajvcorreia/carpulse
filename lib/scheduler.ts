import { createBackup, hasBackupFor } from "@/lib/backup";
import { isScanRunning, markInterruptedRuns, startScan } from "@/lib/scan";
import { getLastScheduledSlot, getScanSettings, setLastScheduledSlot, type ScanSettings } from "@/lib/settings";

// Wall-clock date/time/weekday in the scan's timezone — the container runs
// on UTC, but "06:00" means 06:00 where the user is.
export function localNow(timezone: string, at = new Date()): { date: string; time: string; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return localNow("UTC", at); // unknown timezone name
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: weekdays.indexOf(get("weekday")),
  };
}

// The most recent scheduled slot ("YYYY-MM-DD HH:MM"): the latest of today's
// start times that has passed, on a scheduled day — or null if none has yet.
// Comparing this with the last slot handled, rather than matching the exact
// minute, means a run missed while the app was down (restart, VM reboot)
// still fires once it's back; several missed ones collapse into one run.
export function currentSlot(s: ScanSettings, now = localNow(s.timezone)): string | null {
  if (s.frequency === "weekly" && now.weekday !== s.weekday) return null;
  const passed = s.times.filter((t) => t <= now.time).sort();
  return passed.length ? `${now.date} ${passed[passed.length - 1]}` : null;
}

// Local date of the last backup attempt — once a day, so a failing one
// (disk full, say) is logged daily rather than every minute.
let backupTriedOn = "";

// Today's backup (lib/backup.ts), made on the first tick of each local day,
// whether or not scans are on.
function dailyBackup() {
  try {
    const today = localNow(getScanSettings().timezone).date;
    if (backupTriedOn === today || hasBackupFor(today)) return;
    backupTriedOn = today;
    createBackup(today);
  } catch (err) {
    console.error("[scheduler] daily backup failed:", err);
  }
}

function tick() {
  dailyBackup();
  try {
    const s = getScanSettings();
    if (!s.enabled) return;
    const slot = currentSlot(s);
    const last = getLastScheduledSlot();
    if (!slot || (last && slot <= last)) return;
    setLastScheduledSlot(slot);
    // A start time reached while a scan (manual, or the previous slot's) is
    // still going is skipped, not queued — a second full scan straight after
    // would only re-read the same pages.
    if (isScanRunning()) return;
    startScan("schedule");
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  }
}

const g = globalThis as { __carpulseScheduler?: boolean };

// Called once per server process from instrumentation.ts.
export function startScheduler() {
  if (g.__carpulseScheduler) return;
  g.__carpulseScheduler = true;
  markInterruptedRuns();
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
