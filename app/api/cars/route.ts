import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { getDb, withTransaction } from "@/lib/db/client";
import { toCar } from "@/lib/db/mappers";
import { getCarByUrl, getCarsWithPrices } from "@/lib/data";

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

  const db = getDb();
  const carId = randomUUID();

  try {
    withTransaction(db, () => {
      db.prepare(
        `insert into cars (id, url, make, model, year, km, cylinders, spec, exterior_color, interior_color, ad_placed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        carId,
        body.url,
        body.make,
        body.model,
        body.year,
        body.km ?? null,
        body.cylinders ?? null,
        body.spec ?? null,
        body.exterior_color ?? null,
        body.interior_color ?? null,
        body.ad_placed_at ?? null
      );

      db.prepare(
        "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, coalesce(?, date('now')))"
      ).run(randomUUID(), carId, body.price, body.currency, body.recorded_at ?? null);
    });
  } catch (err) {
    const isUnique = err instanceof Error && err.message.includes("UNIQUE constraint failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create car." },
      { status: isUnique ? 409 : 500 }
    );
  }

  const row = db.prepare("select * from cars where id = ?").get(carId) as Parameters<typeof toCar>[0];

  revalidatePath("/");

  return NextResponse.json({ car: toCar(row) }, { status: 201 });
}
