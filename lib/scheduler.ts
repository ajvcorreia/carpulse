import { isScanRunning, markInterruptedRuns, startScan } from "@/lib/scan";
import { getLastScheduledDate, getScanSettings, setLastScheduledDate, type ScanSettings } from "@/lib/settings";

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

// True once today's start time has passed on a scheduled day. A run missed
// while the app was down (restart, VM reboot) still fires later that day —
// the last-run date, not the exact minute, is what stops it firing twice.
export function isScheduledSlotOpen(s: ScanSettings, now = localNow(s.timezone)) {
  if (s.frequency === "weekly" && now.weekday !== s.weekday) return false;
  return now.time >= s.time;
}

function tick() {
  try {
    const s = getScanSettings();
    if (!s.enabled || isScanRunning()) return;
    const now = localNow(s.timezone);
    if (!isScheduledSlotOpen(s, now) || getLastScheduledDate() === now.date) return;
    setLastScheduledDate(now.date);
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
