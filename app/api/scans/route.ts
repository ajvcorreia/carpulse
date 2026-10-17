import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { runScanNow, scanRunsOverview } from "@/lib/settings-service";

// Recent scan runs (summaries parsed) and whether one is running now.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json(scanRunsOverview());
}

// "Run scan now" — starts one in the background.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const result = runScanNow();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

  revalidatePath("/settings");
  return NextResponse.json(result, { status: 202 });
}
