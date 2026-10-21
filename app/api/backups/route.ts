import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { listBackups } from "@/lib/backup";
import { backupNow } from "@/lib/settings-service";

// The saved database backups, newest first.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json({ backups: listBackups() });
}

// "Back up now".
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const result = backupNow();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  revalidatePath("/settings");
  return NextResponse.json({ ...result, backups: listBackups() }, { status: 201 });
}
