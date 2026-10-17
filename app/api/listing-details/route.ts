import { NextResponse } from "next/server";
import { z } from "zod";
import { checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { fetchListingDetails } from "@/lib/car-service";

const detailsSchema = z.object({ url: z.string() });

// Pre-fill for the add-car form: what the listing page says about the car.
// Nothing is saved.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = await parseJsonBody(req, detailsSchema);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json({ result: await fetchListingDetails(parsed.body.url.trim()) });
}
