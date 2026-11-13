import { NextResponse } from "next/server";
import { z } from "zod";
import type { CarFields } from "@/lib/car-service";
import { blockedFor, clientIp, minutesLeft, recordFailure, safeEqual } from "@/lib/lockout";

// Every /api route is gated by a single shared key (not the UI's sign-in)
// since this API is built for scripts/agents to call unattended, possibly
// from outside the VM itself. Wrong keys count toward the same lockout as
// wrong passwords (lib/lockout.ts); a request with no key at all doesn't.
export function checkApiKey(req: Request): NextResponse | null {
  const expected = process.env.CARPULSE_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "API key not configured on the server." }, { status: 500 });
  }
  const ip = clientIp(req.headers);
  const wait = blockedFor(ip);
  if (wait) {
    return NextResponse.json(
      { error: `Too many wrong API keys. Try again in ${minutesLeft(wait)}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } }
    );
  }
  const given = req.headers.get("x-api-key");
  if (given == null || !safeEqual(given, expected)) {
    if (given != null) recordFailure(ip, "API key");
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  return null;
}

// Parses a JSON request body against `schema`, or returns the 400 response
// to send back — the same shape every /api route has always answered with.
export async function parseJsonBody<T extends z.ZodType>(
  req: Request,
  schema: T
): Promise<{ ok: true; body: z.infer<T> } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: schema.parse(await req.json()) };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: err instanceof z.ZodError ? err.issues : "Invalid request body." },
        { status: 400 }
      ),
    };
  }
}

// The car-detail subset of a create/relist body, with omitted optionals as null.
export function carFieldsFromBody(body: {
  url: string;
  make: string;
  model: string;
  year: number;
  km?: number | null;
  cylinders?: number | null;
  spec?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  ad_placed_at?: string | null;
}): CarFields {
  return {
    url: body.url,
    make: body.make,
    model: body.model,
    year: body.year,
    km: body.km ?? null,
    cylinders: body.cylinders ?? null,
    spec: body.spec ?? null,
    exterior_color: body.exterior_color ?? null,
    interior_color: body.interior_color ?? null,
    ad_placed_at: body.ad_placed_at ?? null,
  };
}
