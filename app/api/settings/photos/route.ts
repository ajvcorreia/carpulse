import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkApiKey, parseJsonBody } from "@/lib/api-auth";
import { applyPhotoSettings } from "@/lib/settings-service";

const photoSchema = z.object({ enabled: z.boolean() });

export async function PUT(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const parsed = await parseJsonBody(req, photoSchema);
  if (!parsed.ok) return parsed.response;

  const result = applyPhotoSettings(parsed.body.enabled);
  revalidatePath("/settings");
  return NextResponse.json(result);
}
