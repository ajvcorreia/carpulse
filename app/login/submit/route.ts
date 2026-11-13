import { checkLogin, createSession, safeNextPath, sessionCookie } from "@/lib/auth";
import { formText, sameOrigin, seeOther } from "@/lib/auth-http";
import { blockedFor, clientIp, recordFailure, recordSuccess } from "@/lib/lockout";

// The sign-in form (app/login/page.tsx) posts here.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden.", { status: 403 });
  const form = await req.formData();
  const next = safeNextPath(formText(form, "next"));
  const back = (query: string) =>
    seeOther(`/login?${query}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);

  const ip = clientIp(req.headers);
  if (blockedFor(ip)) return back("error=blocked");

  if (!(await checkLogin(formText(form, "username"), formText(form, "password")))) {
    const left = recordFailure(ip, "password");
    return back(left ? `error=wrong&left=${left}` : "error=blocked");
  }
  recordSuccess(ip);

  const persistent = form.get("remember") === "on";
  const session = createSession(persistent, { ip, userAgent: req.headers.get("user-agent") });
  const res = seeOther(next);
  res.cookies.set(sessionCookie(session.token, persistent, session.expiresAt, req.headers));
  return res;
}
