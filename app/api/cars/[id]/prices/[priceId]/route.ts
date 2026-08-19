import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; priceId: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id, priceId } = await params;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("price_history")
    .delete()
    .eq("id", priceId)
    .eq("car_id", id)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Price entry not found." }, { status: 404 });

  revalidatePath("/");
  revalidatePath(`/car/${id}`);

  return NextResponse.json({ deleted: data });
}
