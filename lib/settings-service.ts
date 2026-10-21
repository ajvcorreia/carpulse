import { z } from "zod";
import { createBackup, listBackups } from "@/lib/backup";
import { getDb } from "@/lib/db/client";
import { sendEmail } from "@/lib/email";
import { countCarsWithPhotos } from "@/lib/photos";
import { getRecentScanRuns, isScanRunning, requestScanStop, startScan, type ScanSummary } from "@/lib/scan";
import { currentSlot, localNow } from "@/lib/scheduler";
import {
  getEmailSettings,
  getLastScheduledSlot,
  getPhotoSettings,
  getScanSettings,
  saveEmailSettings,
  savePhotoSettings,
  saveScanSettings,
  setLastScheduledSlot,
  type EmailSettings,
  type ScanSettings,
} from "@/lib/settings";

// Settings/scan operations behind both the settings page's server actions
// (lib/settings-actions.ts, fed by HTML forms) and the REST API (JSON, for
// the native app). The schemas take how a boolean arrives as a parameter:
// a form checkbox is "on" or missing, JSON sends a real true/false.

export type SettingsResult = { ok: true; message?: string } | { ok: false; error: string };

type BoolSchema = z.ZodType<boolean, unknown>;

export const formCheckbox: BoolSchema = z.preprocess((v) => v === "on" || v === "true", z.boolean());
export const jsonBoolean: BoolSchema = z.boolean();

export function scanSettingsSchema(bool: BoolSchema) {
  return z
    .object({
      enabled: bool,
      times: z
        .array(z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Start times must be HH:MM."))
        .min(1, "Add at least one start time.")
        .max(24, "At most 24 start times.")
        .transform((times) => Array.from(new Set(times)).sort()),
      frequency: z.enum(["daily", "weekly"]),
      weekday: z.coerce.number().int().min(0).max(6),
      timezone: z.string().min(1),
      minPauseSeconds: z.coerce.number().int().min(0).max(600),
      maxPauseSeconds: z.coerce.number().int().min(0).max(600),
    })
    .refine((s) => s.maxPauseSeconds >= s.minPauseSeconds, "Max pause must be at least the min pause.");
}

export function emailSettingsSchema(bool: BoolSchema) {
  return z.object({
    enabled: bool,
    onlyWhenChanged: bool,
    to: z.string().trim(),
    from: z.string().trim(),
    smtpHost: z.string().trim(),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpSecure: bool,
    smtpUser: z.string().trim(),
    // Optional so a JSON client can leave it out entirely to keep the saved one.
    smtpPassword: z.string().default(""),
    appUrl: z.string().trim(),
  });
}

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid settings.";
}

export function applyScanSettings(
  schema: ReturnType<typeof scanSettingsSchema>,
  input: unknown
): SettingsResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const s: ScanSettings = parsed.data;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
  } catch {
    return { ok: false, error: `Unknown timezone "${s.timezone}".` };
  }
  saveScanSettings(s);

  // Start times already past today count as done, so the next run is the
  // next upcoming time — otherwise saving at 10:00 a schedule for 06:00 would
  // start a scan right away, as if it were catching up on a missed run.
  const slot = currentSlot(s);
  if (slot) setLastScheduledSlot(slot);

  return { ok: true, message: "Saved." };
}

// A blank password means "keep the saved one" — the stored password is
// never sent back to a client, so it can't be pre-filled.
export function parseEmailSettings(
  schema: ReturnType<typeof emailSettingsSchema>,
  input: unknown
): { ok: true; value: EmailSettings } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const value = parsed.data;
  if (!value.smtpPassword) value.smtpPassword = getEmailSettings().smtpPassword;
  return { ok: true, value };
}

export function applyEmailSettings(value: EmailSettings): SettingsResult {
  saveEmailSettings(value);
  return { ok: true, message: "Saved." };
}

// Uses the settings passed in, saved or not, so they can be tried before
// committing to them.
export async function sendTestEmail(value: EmailSettings): Promise<SettingsResult> {
  try {
    await sendEmail(
      value,
      "CarPulse test email",
      "Email from CarPulse is working. Scan summaries will arrive like this.",
      "<p>Email from CarPulse is working. Scan summaries will arrive like this.</p>"
    );
    return { ok: true, message: `Test email sent to ${value.to}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sending failed." };
  }
}

export function applyPhotoSettings(enabled: boolean): SettingsResult {
  savePhotoSettings({ enabled });
  return { ok: true, message: "Saved." };
}

export function runScanNow(): SettingsResult {
  if (!startScan("manual")) return { ok: false, error: "A scan is already running." };
  return { ok: true };
}

export function stopScan(): SettingsResult {
  if (!isScanRunning()) return { ok: false, error: "No scan is running." };
  requestScanStop();
  return { ok: true, message: "Stopping after the current car…" };
}

// "Back up now" — replaces today's backup if there already is one.
export function backupNow(): SettingsResult {
  try {
    const backup = createBackup(localNow(getScanSettings().timezone).date);
    return { ok: true, message: `Saved ${backup.name}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Backup failed." };
  }
}

// Everything the settings page shows, minus the SMTP password (only whether
// one is saved).
export function settingsOverview() {
  const { smtpPassword, ...email } = getEmailSettings();
  const db = getDb();
  return {
    scan: getScanSettings(),
    last_scheduled_slot: getLastScheduledSlot(),
    email,
    has_smtp_password: smtpPassword !== "",
    photos: getPhotoSettings(),
    cars_with_photos: countCarsWithPhotos(),
    total_cars: (db.prepare("select count(*) as n from cars").get() as { n: number }).n,
    // Struck-out cars are skipped by a scan.
    scanned_cars: (db.prepare("select count(*) as n from cars where is_struck_out = 0").get() as { n: number }).n,
    backups: listBackups(),
  };
}

// Recent runs with their summaries already parsed, for API clients.
export function scanRunsOverview(limit = 10) {
  return {
    running: isScanRunning(),
    runs: getRecentScanRuns(limit).map((r) => ({
      ...r,
      summary: r.summary ? (JSON.parse(r.summary) as ScanSummary) : null,
    })),
  };
}
