import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey } from "@/lib/api-auth";
import { getDb } from "@/lib/db/client";

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

  const db = getDb();
  const priceId = randomUUID();

  try {
    db.prepare(
      "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, coalesce(?, date('now')))"
    ).run(priceId, id, body.price, body.currency, body.recorded_at ?? null);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not add price." },
      { status: 500 }
    );
  }

  const price = db.prepare("select * from price_history where id = ?").get(priceId);

  revalidatePath("/");

  return NextResponse.json({ price }, { status: 201 });
}
