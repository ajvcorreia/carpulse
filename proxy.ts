import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Opt-in: the app has always relied on "the VM is on a private network" as
// its access control. Setting both AUTH_USERNAME and AUTH_PASSWORD adds a
// browser-native login prompt on top of that for anyone who wants it;
// leaving either unset keeps today's no-login behavior exactly as it was.
//
// /api/** is excluded (see config.matcher below) — it already has its own
// X-API-Key scheme (lib/api-auth.ts) built for unattended scripts/agents,
// which can't handle an interactive Basic Auth challenge anyway.
export function proxy(req: NextRequest) {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) return NextResponse.next();

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separatorIndex = decoded.indexOf(":");
    const providedUser = decoded.slice(0, separatorIndex);
    const providedPass = decoded.slice(separatorIndex + 1);
    if (providedUser === username && providedPass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CarPulse"' },
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
