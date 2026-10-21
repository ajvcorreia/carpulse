import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { getLastUndo, undoLastChange } from "@/lib/undo";

// The most recent undoable change, or null.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json({ last: getLastUndo() });
}

// Undoes the most recent change. Optional body {"id": ...}: only undo if
// that's still the most recent one (409 otherwise).
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const result = await undoLastChange(typeof body?.id === "string" ? body.id : undefined);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

  revalidatePath("/");
  return NextResponse.json({ undone: result.label, last: getLastUndo() });
}
