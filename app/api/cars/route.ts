import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const urlFilter = new URL(req.url).searchParams.get("url");

  const supabase = createClient();
  let query = supabase.from("cars").select("*, price_history(*)").order("created_at", { ascending: false });
  if (urlFilter) query = query.eq("url", urlFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cars: data });
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
});

export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  let body: z.infer<typeof createCarSchema>;
  try {
    body = createCarSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues : "Invalid request body." },
      { status: 400 }
    );
  }

  const supabase = createClient();
  const { data: car, error: carError } = await supabase
    .from("cars")
    .insert({
      url: body.url,
      make: body.make,
      model: body.model,
      year: body.year,
      km: body.km ?? null,
      cylinders: body.cylinders ?? null,
      spec: body.spec ?? null,
      exterior_color: body.exterior_color ?? null,
      interior_color: body.interior_color ?? null,
      ad_placed_at: body.ad_placed_at ?? null,
    })
    .select("*")
    .single();

  if (carError || !car) {
    const status = carError?.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: carError?.message ?? "Could not create car." }, { status });
  }

  const { error: priceError } = await supabase.from("price_history").insert({
    car_id: car.id,
    price: body.price,
    currency: body.currency,
    ...(body.recorded_at ? { recorded_at: body.recorded_at } : {}),
  });

  if (priceError) {
    return NextResponse.json({ error: priceError.message }, { status: 500 });
  }

  revalidatePath("/");

  return NextResponse.json({ car }, { status: 201 });
}
