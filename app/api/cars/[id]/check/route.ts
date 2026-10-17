import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { checkListing } from "@/lib/car-service";

// "Check listing for updates": asks the scraper sidecar to read the listing
// and logs its price if it changed. Slow (a headless browser) — up to ~90s.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const result = await checkListing(id);
  if (result.kind === "updated" || (result.photosSaved ?? 0) > 0) revalidatePath("/");

  return NextResponse.json({ result });
}
