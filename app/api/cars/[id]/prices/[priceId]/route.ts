import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { getDb } from "@/lib/db/client";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; priceId: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id, priceId } = await params;

  const db = getDb();
  const deleted = db
    .prepare("select * from price_history where id = ? and car_id = ?")
    .get(priceId, id);

  if (!deleted) return NextResponse.json({ error: "Price entry not found." }, { status: 404 });

  db.prepare("delete from price_history where id = ?").run(priceId);

  revalidatePath("/");

  return NextResponse.json({ deleted });
}
