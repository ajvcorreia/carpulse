import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { applyScanSettings, jsonBoolean, scanSettingsSchema } from "@/lib/settings-service";

const scanSchema = scanSettingsSchema(jsonBoolean);

export async function PUT(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const result = applyScanSettings(scanSchema, await req.json().catch(() => null));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  revalidatePath("/settings");
  return NextResponse.json(result);
}
