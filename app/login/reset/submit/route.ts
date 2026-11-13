import {
  consumeResetToken,
  createSession,
  deleteAllSessions,
  passwordProblem,
  sessionCookie,
  setPassword,
} from "@/lib/auth";
import { formText, sameOrigin, seeOther } from "@/lib/auth-http";
import { blockedFor, clientIp, recordFailure, recordSuccess } from "@/lib/lockout";

// The new-password form behind an emailed reset link
// (app/login/reset/page.tsx). On success every other browser is signed
// out and this one is signed in.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden.", { status: 403 });
  const form = await req.formData();
  const token = formText(form, "token");
  const back = (error: string) => seeOther(`/login/reset?token=${encodeURIComponent(token)}&error=${error}`);

  const ip = clientIp(req.headers);
  if (blockedFor(ip)) return back("blocked");

  const password = formText(form, "password");
  const confirm = formText(form, "confirm");
  if (passwordProblem(password, confirm)) return back(password !== confirm ? "mismatch" : "short");

  if (!consumeResetToken(token)) {
    recordFailure(ip, "reset link");
    return back("invalid");
  }
  await setPassword(password);
  deleteAllSessions();
  recordSuccess(ip);

  const session = createSession(true, { ip, userAgent: req.headers.get("user-agent") });
  const res = seeOther("/");
  res.cookies.set(sessionCookie(session.token, true, session.expiresAt, req.headers));
  return res;
}
