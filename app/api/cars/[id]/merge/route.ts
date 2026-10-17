import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { mergeCarRecords } from "@/lib/car-service";
import { getCarWithPrices } from "@/lib/data";

const mergeSchema = z.object({
  merge_from_car_id: z.string().min(1),
  // The per-field picks — replace whatever the kept car had.
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number(),
  cylinders: z.number().nullable().optional(),
  spec: z.string().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  interior_color: z.string().nullable().optional(),
});

// Merges merge_from_car_id into this car (the one kept as the current
// listing) — see mergeCarRecords for what carries over.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const parsed = await parseJsonBody(req, mergeSchema);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const result = await mergeCarRecords(id, body.merge_from_car_id, {
    make: body.make.trim(),
    model: body.model.trim(),
    year: body.year,
    cylinders: body.cylinders ?? null,
    spec: body.spec?.trim() || null,
    exterior_color: body.exterior_color?.trim() || null,
    interior_color: body.interior_color?.trim() || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  revalidatePath("/");

  return NextResponse.json({ car: await getCarWithPrices(id) });
}
