import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { getDb } from "@/lib/db/client";
import { getCarWithPrices } from "@/lib/data";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const car = await getCarWithPrices(id);
  if (!car) return NextResponse.json({ error: "Car not found." }, { status: 404 });

  return NextResponse.json({ car });
}

const updateCarSchema = z
  .object({
    url: z.string().url().optional(),
    make: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    year: z.number().optional(),
    km: z.number().nullable().optional(),
    cylinders: z.number().nullable().optional(),
    spec: z.string().nullable().optional(),
    exterior_color: z.string().nullable().optional(),
    interior_color: z.string().nullable().optional(),
    ad_placed_at: z.string().nullable().optional(),
    is_removed: z.boolean().optional(),
    is_favorite: z.boolean().optional(),
    is_struck_out: z.boolean().optional(),
    strike_out_reason: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update." });

const BOOLEAN_COLUMNS = new Set(["is_removed", "is_favorite", "is_struck_out"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  let body: z.infer<typeof updateCarSchema>;
  try {
    body = updateCarSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues : "Invalid request body." },
      { status: 400 }
    );
  }

  // Matches the UI's setCarStruckOut: turning the flag off clears the reason
  // unless the caller is setting a new one in the same request.
  const patch: Record<string, unknown> = { ...body };
  if (body.is_struck_out === false && body.strike_out_reason === undefined) {
    patch.strike_out_reason = null;
  }

  const columns = Object.keys(patch);
  const setClause = columns.map((col) => `${col} = ?`).join(", ");
  const values = columns.map((col): string | number | null => {
    const value = patch[col];
    if (BOOLEAN_COLUMNS.has(col)) return value ? 1 : 0;
    return value as string | number | null;
  });

  const db = getDb();

  try {
    const result = db.prepare(`update cars set ${setClause} where id = ?`).run(...values, id);
    if (result.changes === 0) return NextResponse.json({ error: "Car not found." }, { status: 404 });
  } catch (err) {
    const isUnique = err instanceof Error && err.message.includes("UNIQUE constraint failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update car." },
      { status: isUnique ? 409 : 500 }
    );
  }

  revalidatePath("/");

  const car = await getCarWithPrices(id);
  return NextResponse.json({ car });
}
