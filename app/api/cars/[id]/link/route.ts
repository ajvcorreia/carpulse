import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { linkCarRecords, unlinkCarRecord } from "@/lib/car-service";

const linkSchema = z.object({ car_id: z.string().min(1) });

// "Also listed at": links this car with car_id (and both their groups).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const parsed = await parseJsonBody(req, linkSchema);
  if (!parsed.ok) return parsed.response;

  const result = linkCarRecords(id, parsed.body.car_id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  revalidatePath("/");
  return NextResponse.json({ success: true });
}

// Takes this car out of its "also listed at" group.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
  const { id } = await params;

  const result = unlinkCarRecord(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  revalidatePath("/");
  return NextResponse.json({ success: true });
}
