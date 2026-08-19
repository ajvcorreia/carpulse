import { NextResponse } from "next/server";

// Every /api route is gated by a single shared key (not the LAN-only trust
// model the UI relies on) since this API is built for scripts/agents to call
// unattended, possibly from outside the VM itself.
export function checkApiKey(req: Request): NextResponse | null {
  const expected = process.env.DUBBIZLEWATCH_API_KEY;
  if (!expected) {
    return NextResponse.json({ error: "API key not configured on the server." }, { status: 500 });
  }
  if (req.headers.get("x-api-key") !== expected) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }
  return null;
}
