import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { applyEmailSettings, emailSettingsSchema, jsonBoolean, parseEmailSettings } from "@/lib/settings-service";

const emailSchema = emailSettingsSchema(jsonBoolean);

// A blank or missing smtpPassword keeps the saved one.
export async function PUT(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = parseEmailSettings(emailSchema, await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = applyEmailSettings(parsed.value);
  revalidatePath("/settings");
  return NextResponse.json(result);
}
