import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { stopScan } from "@/lib/settings-service";

// Asks the running scan to stop after the car it's on.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const result = stopScan();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
