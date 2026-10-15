import { getDb } from "@/lib/db/client";

export type Frequency = "daily" | "weekly";

export type ScanSettings = {
  enabled: boolean;
  // "HH:MM", 24h, in `timezone`.
  time: string;
  frequency: Frequency;
  // 0 = Sunday … 6 = Saturday; only used when frequency is "weekly".
  weekday: number;
  // IANA zone the start time is in — the container itself runs on UTC.
  timezone: string;
  // Random pause between two listing checks, so a scan doesn't hit a site
  // at a machine-regular rhythm.
  minPauseSeconds: number;
  maxPauseSeconds: number;
};

export type EmailSettings = {
  enabled: boolean;
  // Skip the email when a scan found nothing new.
  onlyWhenChanged: boolean;
  to: string;
  from: string;
  smtpHost: string;
  smtpPort: number;
  // true = TLS from the start (port 465); false = STARTTLS when offered (587).
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  // Optional — makes car names in the email link back to the dashboard.
  appUrl: string;
};

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  enabled: false,
  time: "06:00",
  frequency: "daily",
  weekday: 1,
  timezone: "Asia/Dubai",
  minPauseSeconds: 10,
  maxPauseSeconds: 40,
};

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  onlyWhenChanged: true,
  to: "",
  from: "",
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  appUrl: "",
};

function read<T extends object>(key: string, defaults: T): T {
  const row = getDb().prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
  if (!row) return { ...defaults };
  try {
    // Spread over defaults so a setting added later gets its default on
    // rows saved before it existed.
    return { ...defaults, ...JSON.parse(row.value) };
  } catch {
    return { ...defaults };
  }
}

function write(key: string, value: object) {
  getDb()
    .prepare("insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value")
    .run(key, JSON.stringify(value));
}

export type PhotoSettings = {
  // Download a listing's photos the first time its page is read (adding the
  // car, "Check listing for updates", or a scan) — see lib/photos.ts.
  enabled: boolean;
};

export const DEFAULT_PHOTO_SETTINGS: PhotoSettings = { enabled: false };

export const getScanSettings = () => read("scan", DEFAULT_SCAN_SETTINGS);
export const saveScanSettings = (s: ScanSettings) => write("scan", s);
export const getEmailSettings = () => read("email", DEFAULT_EMAIL_SETTINGS);
export const saveEmailSettings = (s: EmailSettings) => write("email", s);
export const getPhotoSettings = () => read("photos", DEFAULT_PHOTO_SETTINGS);
export const savePhotoSettings = (s: PhotoSettings) => write("photos", s);

// Scheduler bookkeeping, kept apart from the user-facing settings: the local
// date (in the scan timezone) the last *scheduled* run was started for, so
// each day/week fires once even across restarts.
export function getLastScheduledDate(): string | null {
  return read<{ date: string | null }>("scan_last_scheduled", { date: null }).date;
}

export function setLastScheduledDate(date: string) {
  write("scan_last_scheduled", { date });
}
