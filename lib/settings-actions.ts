"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { isScanRunning, requestScanStop, startScan } from "@/lib/scan";
import { isScheduledSlotOpen, localNow } from "@/lib/scheduler";
import {
  getEmailSettings,
  saveEmailSettings,
  saveScanSettings,
  setLastScheduledDate,
  type EmailSettings,
  type ScanSettings,
} from "@/lib/settings";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const scanSchema = z
  .object({
    enabled: checkbox,
    time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Start time must be HH:MM."),
    frequency: z.enum(["daily", "weekly"]),
    weekday: z.coerce.number().int().min(0).max(6),
    timezone: z.string().min(1),
    minPauseSeconds: z.coerce.number().int().min(0).max(600),
    maxPauseSeconds: z.coerce.number().int().min(0).max(600),
  })
  .refine((s) => s.maxPauseSeconds >= s.minPauseSeconds, "Max pause must be at least the min pause.");

export async function saveScanSettingsAction(_prev: unknown, formData: FormData): Promise<Result> {
  const parsed = scanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const s: ScanSettings = parsed.data;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
  } catch {
    return { ok: false, error: `Unknown timezone "${s.timezone}".` };
  }
  saveScanSettings(s);

  // If today's slot has already passed, the next run is the *next* slot —
  // otherwise saving at 10:00 a schedule for 06:00 would start a scan right
  // away, as if it were catching up on a missed run.
  const now = localNow(s.timezone);
  if (isScheduledSlotOpen(s, now)) setLastScheduledDate(now.date);

  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

const emailSchema = z.object({
  enabled: checkbox,
  onlyWhenChanged: checkbox,
  to: z.string().trim(),
  from: z.string().trim(),
  smtpHost: z.string().trim(),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: checkbox,
  smtpUser: z.string().trim(),
  smtpPassword: z.string(),
  appUrl: z.string().trim(),
});

// A blank password field means "keep the saved one" — the page never sends
// the stored password back to the browser, so it can't be pre-filled.
function parseEmail(formData: FormData): { ok: true; value: EmailSettings } | { ok: false; error: string } {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const value = parsed.data;
  if (!value.smtpPassword) value.smtpPassword = getEmailSettings().smtpPassword;
  return { ok: true, value };
}

export async function saveEmailSettingsAction(_prev: unknown, formData: FormData): Promise<Result> {
  const parsed = parseEmail(formData);
  if (!parsed.ok) return parsed;
  saveEmailSettings(parsed.value);
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

// Uses what's in the form right now, saved or not, so settings can be tried
// before committing to them.
export async function sendTestEmailAction(formData: FormData): Promise<Result> {
  const parsed = parseEmail(formData);
  if (!parsed.ok) return parsed;
  try {
    await sendEmail(
      parsed.value,
      "CarPulse test email",
      "Email from CarPulse is working. Scan summaries will arrive like this.",
      "<p>Email from CarPulse is working. Scan summaries will arrive like this.</p>"
    );
    return { ok: true, message: `Test email sent to ${parsed.value.to}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sending failed." };
  }
}

export async function runScanNowAction(): Promise<Result> {
  if (!startScan("manual")) return { ok: false, error: "A scan is already running." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function stopScanAction(): Promise<Result> {
  if (!isScanRunning()) return { ok: false, error: "No scan is running." };
  requestScanStop();
  return { ok: true, message: "Stopping after the current car…" };
}
