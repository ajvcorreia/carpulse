import { NextResponse } from "next/server";
import { z } from "zod";
import { checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { findPossibleDuplicate } from "@/lib/car-service";

const duplicateSchema = z.object({
  make: z.string(),
  model: z.string(),
  km: z.number().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  interior_color: z.string().nullable().optional(),
});

// The add flow's "is this already tracked under another URL?" check — run
// before creating a car, so the client can offer relist / link / add anyway.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = await parseJsonBody(req, duplicateSchema);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const duplicate = findPossibleDuplicate({
    make: body.make.trim(),
    model: body.model.trim(),
    km: body.km ?? null,
    exteriorColor: body.exterior_color?.trim() || null,
    interiorColor: body.interior_color?.trim() || null,
  });

  return NextResponse.json({ duplicate });
}
