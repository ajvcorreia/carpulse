import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { markCarOpenedRecord } from "@/lib/car-service";

// Records that the listing was just opened, for the dashboard's "the one you
// were last looking at" highlight.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  if (!markCarOpenedRecord(id)) return NextResponse.json({ error: "Car not found." }, { status: 404 });

  revalidatePath("/");
  return NextResponse.json({ success: true });
}
