import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { checkApiKey } from "@/lib/api-auth";
import { importCars } from "@/lib/car-service";

// Body: a CarPulse export file, as-is. Only ever adds — see importCars.
export async function POST(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "That file isn't valid CarPulse export JSON." }, { status: 400 });
  }

  const result = importCars(json);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  revalidatePath("/");
  return NextResponse.json({ summary: result.summary });
}
