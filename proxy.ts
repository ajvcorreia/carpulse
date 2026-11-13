import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, sessionCookie, validateSession } from "@/lib/auth";
import { requestOrigin } from "@/lib/auth-http";

// The UI's sign-in gate (lib/auth.ts). Off — everything open, as before —
// until AUTH_USERNAME/AUTH_PASSWORD are set or a login is stored.
//
// /api/** is excluded (see config.matcher below) — it has its own X-API-Key
// scheme (lib/api-auth.ts) for scripts and the iOS app.
//
// Signed out, only the sign-in pages are reachable, and only by GET — plus
// POSTs to their own form handlers (route.ts files). Any other POST is
// refused: a server action can be posted to any page path, so leaving
// /login open to POSTs would let one run without signing in.
const PUBLIC_PAGES = new Set(["/login", "/login/forgot", "/login/reset"]);
const PUBLIC_FORM_HANDLERS = new Set(["/login/submit", "/login/forgot/submit", "/login/reset/submit"]);

export function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const path = req.nextUrl.pathname;
  const isRead = req.method === "GET" || req.method === "HEAD";
  if (isRead && PUBLIC_PAGES.has(path)) return NextResponse.next();
  if (req.method === "POST" && PUBLIC_FORM_HANDLERS.has(path)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? validateSession(token) : null;
  if (session) {
    const res = NextResponse.next();
    if (session.refreshed && token) {
      res.cookies.set(sessionCookie(token, session.persistent, session.expiresAt, req.headers));
    }
    return res;
  }

  if (isRead) {
    // On the host and scheme the browser used (Cloudflare's, not the
    // container's) — a proxy redirect has to be an absolute URL.
    const next = path === "/" ? "" : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
    return NextResponse.redirect(`${requestOrigin(req.headers)}/login${next}`, 303);
  }
  return new NextResponse("Sign in required.", { status: 401 });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
