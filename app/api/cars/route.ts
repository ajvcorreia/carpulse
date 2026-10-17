import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { carFieldsFromBody, checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { createCarRecord } from "@/lib/car-service";
import { getCarByUrl, getCarWithPrices, getCarsWithPrices } from "@/lib/data";

export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const urlFilter = new URL(req.url).searchParams.get("url");
  const cars = urlFilter ? await getCarByUrl(urlFilter).then((c) => (c ? [c] : [])) : await getCarsWithPrices();

  return NextResponse.json({ cars });
}

const createCarSchema = z.object({
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
  currency: z.string().min(1).default("AED"),
  recorded_at: z.string().optional(),
  // Same options as the UI's add flow: link to an existing car ("also
  // listed elsewhere"), and photo URLs found by /api/listing-details.
  also_listed_at_car_id: z.string().nullable().optional(),
  photo_urls: z.array(z.string()).max(40).optional(),
});

export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = await parseJsonBody(req, createCarSchema);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const result = await createCarRecord({
    fields: carFieldsFromBody(body),
    price: body.price,
    currency: body.currency,
    recordedAt: body.recorded_at ?? null,
    alsoListedAtCarId: body.also_listed_at_car_id,
    photoUrls: body.photo_urls,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.conflict ? 409 : 500 });

  revalidatePath("/");

  return NextResponse.json({ car: await getCarWithPrices(result.id) }, { status: 201 });
}
