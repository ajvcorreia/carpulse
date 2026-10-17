"use server";

import { revalidatePath } from "next/cache";
import {
  applyEmailSettings,
  applyPhotoSettings,
  applyScanSettings,
  emailSettingsSchema,
  formCheckbox,
  parseEmailSettings,
  runScanNow,
  scanSettingsSchema,
  sendTestEmail,
  stopScan,
  type SettingsResult,
} from "@/lib/settings-service";

// FormData wrappers over lib/settings-service.ts, shared with the REST API.

const scanSchema = scanSettingsSchema(formCheckbox);
const emailSchema = emailSettingsSchema(formCheckbox);

export async function saveScanSettingsAction(_prev: unknown, formData: FormData): Promise<SettingsResult> {
  // One "time" input per start time, so they're read as a list.
  const result = applyScanSettings(scanSchema, { ...Object.fromEntries(formData), times: formData.getAll("time") });
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function saveEmailSettingsAction(_prev: unknown, formData: FormData): Promise<SettingsResult> {
  const parsed = parseEmailSettings(emailSchema, Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  const result = applyEmailSettings(parsed.value);
  revalidatePath("/settings");
  return result;
}

export async function sendTestEmailAction(formData: FormData): Promise<SettingsResult> {
  const parsed = parseEmailSettings(emailSchema, Object.fromEntries(formData));
  if (!parsed.ok) return parsed;
  return sendTestEmail(parsed.value);
}

export async function savePhotoSettingsAction(_prev: unknown, formData: FormData): Promise<SettingsResult> {
  const result = applyPhotoSettings(formCheckbox.parse(formData.get("enabled")));
  revalidatePath("/settings");
  return result;
}

export async function runScanNowAction(): Promise<SettingsResult> {
  const result = runScanNow();
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function stopScanAction(): Promise<SettingsResult> {
  return stopScan();
}
