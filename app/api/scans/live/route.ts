import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { getLiveScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

// The running scan's live state (every car's result so far, what it's doing
// now), or the last one since the app started.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json(getLiveScan());
}
