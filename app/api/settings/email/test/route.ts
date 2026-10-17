import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { emailSettingsSchema, jsonBoolean, parseEmailSettings, sendTestEmail } from "@/lib/settings-service";

const emailSchema = emailSettingsSchema(jsonBoolean);

// Sends a test email with the settings in the body, saved or not.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = parseEmailSettings(emailSchema, await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await sendTestEmail(parsed.value);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
