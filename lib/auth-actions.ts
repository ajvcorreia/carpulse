"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkLogin,
  currentUsername,
  deleteAllSessions,
  deleteSession,
  passwordProblem,
  SESSION_COOKIE,
  setPassword,
  validateSession,
} from "@/lib/auth";
import { blockedFor, clientIp, minutesLeft, recordFailure, recordSuccess } from "@/lib/lockout";
import { saveLoginSettings } from "@/lib/settings";
import type { SettingsResult } from "@/lib/settings-service";

// Signed-in account actions (Settings → Sign-in, the header's "Sign out").
// proxy.ts already turns away signed-out requests; each action checks the
// session again anyway, as Next recommends for server actions.

async function currentToken() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token && validateSession(token) ? token : null;
}

async function signedOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login?signedout=1");
}

export async function signOutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  await signedOut();
}

export async function signOutEverywhereAction() {
  if (!(await currentToken())) return signedOut();
  deleteAllSessions();
  await signedOut();
}

export async function changePasswordAction(_prev: unknown, formData: FormData): Promise<SettingsResult> {
  const token = await currentToken();
  if (!token) return { ok: false, error: "Your session has ended — sign in again." };
  const ip = clientIp(await headers());
  const wait = blockedFor(ip);
  if (wait) return { ok: false, error: `Too many wrong passwords. Try again in ${minutesLeft(wait)}.` };

  const text = (name: string) => String(formData.get(name) ?? "");
  if (!(await checkLogin(currentUsername() ?? "", text("current")))) {
    const left = recordFailure(ip, "password");
    return {
      ok: false,
      error: left
        ? "The current password is wrong."
        : "The current password is wrong. Too many tries — blocked for 10 minutes.",
    };
  }
  recordSuccess(ip);
  const problem = passwordProblem(text("password"), text("confirm"));
  if (problem) return { ok: false, error: problem };

  await setPassword(text("password"));
  deleteAllSessions(token);
  revalidatePath("/settings");
  return { ok: true, message: "Password changed. Other devices were signed out." };
}

const loginSettingsSchema = z.object({
  sessionDays: z.coerce
    .number({ error: "Enter a number of days." })
    .int("Enter a whole number of days.")
    .min(1, "At least 1 day.")
    .max(365, "At most 365 days."),
});

export async function saveLoginSettingsAction(_prev: unknown, formData: FormData): Promise<SettingsResult> {
  if (!(await currentToken())) return { ok: false, error: "Your session has ended — sign in again." };
  const parsed = loginSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid value." };
  saveLoginSettings(parsed.data);
  revalidatePath("/settings");
  return { ok: true, message: "Saved. Applies from each device's next visit." };
}
