import { NextResponse } from "next/server";
import { getLiveScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

// What /scan and the dashboard's "Watch live" button poll (behind the UI's
// login prompt). ?brief=1 is just whether a scan runs and how far it got.
export async function GET(req: Request) {
  const live = getLiveScan();
  if (new URL(req.url).searchParams.has("brief")) {
    return NextResponse.json({
      running: live.running,
      checked: live.scan?.checked ?? 0,
      total: live.scan?.total ?? 0,
    });
  }
  return NextResponse.json(live);
}
