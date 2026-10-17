import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { settingsOverview } from "@/lib/settings-service";

// Everything the settings page shows. The SMTP password is never returned —
// only has_smtp_password.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json(settingsOverview());
}
