import { createResetToken } from "@/lib/auth";
import { requestOrigin, sameOrigin, seeOther } from "@/lib/auth-http";
import { emailConfigProblem, sendEmail } from "@/lib/email";
import { blockedFor, clientIp } from "@/lib/lockout";
import { getEmailSettings } from "@/lib/settings";

// "Email me a reset link" (app/login/forgot/page.tsx). The link only ever
// goes to the scan email's recipient — nobody can type in an address — and
// at most one is sent every few minutes (createResetToken).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden.", { status: 403 });
  if (blockedFor(clientIp(req.headers))) return seeOther("/login/forgot?error=blocked");

  const email = getEmailSettings();
  if (emailConfigProblem(email)) return seeOther("/login/forgot?error=noemail");

  const token = createResetToken();
  if (token) {
    const base = (email.appUrl || requestOrigin(req.headers)).replace(/\/$/, "");
    const link = `${base}/login/reset?token=${token}`;
    const intro = "Someone (hopefully you) asked to reset the CarPulse password.";
    const outro = "The link works once, for 30 minutes. If you didn't ask for this, ignore this email — nothing changes.";
    try {
      await sendEmail(
        email,
        "CarPulse: reset your password",
        `${intro}\n\nSet a new password here:\n${link}\n\n${outro}`,
        `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#18181b">
<p>${intro}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#2a78d6;color:#ffffff;font-weight:600;text-decoration:none">Set a new password</a></p>
<p style="color:#71717a">${outro}</p>
</div>`
      );
    } catch (err) {
      console.error("Sending the password reset email failed:", err);
      return seeOther("/login/forgot?error=send");
    }
  }
  return seeOther("/login/forgot?sent=1");
}
