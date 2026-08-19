import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type CarUpdate = Database["public"]["Tables"]["cars"]["Update"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const supabase = createClient();
  const { data, error } = await supabase.from("cars").select("*, price_history(*)").eq("id", id).maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Car not found." }, { status: 404 });

  return NextResponse.json({ car: data });
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
  const patch: CarUpdate = { ...body };
  if (body.is_struck_out === false && body.strike_out_reason === undefined) {
    patch.strike_out_reason = null;
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cars")
    .update(patch)
    .eq("id", id)
    .select("*, price_history(*)")
    .maybeSingle();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!data) return NextResponse.json({ error: "Car not found." }, { status: 404 });

  revalidatePath("/");
  revalidatePath(`/car/${id}`);

  return NextResponse.json({ car: data });
}
