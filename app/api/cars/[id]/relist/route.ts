import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { carFieldsFromBody, checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { relistCarRecord } from "@/lib/car-service";
import { getCarWithPrices } from "@/lib/data";

const relistSchema = z.object({
  url: z.string().url(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number(),
  km: z.number().nullable().optional(),
  cylinders: z.number().nullable().optional(),
  spec: z.string().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  interior_color: z.string().nullable().optional(),
  ad_placed_at: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  recorded_at: z.string().optional(),
  photo_urls: z.array(z.string()).max(40).optional(),
});

// Same car re-listed under a new URL: updates this car in place, archiving
// its old URL to listing history and keeping its price history.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const parsed = await parseJsonBody(req, relistSchema);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const result = await relistCarRecord({
    existingCarId: id,
    fields: carFieldsFromBody(body),
    price: body.price,
    recordedAt: body.recorded_at ?? null,
    photoUrls: body.photo_urls,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.conflict ? 409 : 400 });

  revalidatePath("/");

  return NextResponse.json({ car: await getCarWithPrices(id) });
}
