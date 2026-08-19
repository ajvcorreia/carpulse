import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

const addPriceSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().min(1).default("AED"),
  recorded_at: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  let body: z.infer<typeof addPriceSchema>;
  try {
    body = addPriceSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues : "Invalid request body." },
      { status: 400 }
    );
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_history")
    .insert({
      car_id: id,
      price: body.price,
      currency: body.currency,
      ...(body.recorded_at ? { recorded_at: body.recorded_at } : {}),
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not add price." }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath(`/car/${id}`);

  return NextResponse.json({ price: data }, { status: 201 });
}
