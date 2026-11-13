import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";
import { emailConfigProblem } from "@/lib/email";
import { blockedFor, clientIp, minutesLeft } from "@/lib/lockout";
import { getEmailSettings } from "@/lib/settings";
import { AuthCard, Notice, submitClass } from "../AuthCard";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function ForgotPage({ searchParams }: { searchParams: Params }) {
  if (!authEnabled()) redirect("/");
  const params = await searchParams;
  const wait = blockedFor(clientIp(await headers()));
  const emailReady = !emailConfigProblem(getEmailSettings());

  return (
    <AuthCard title="Forgot password">
      {wait ? (
        <Notice tone="error">Too many wrong attempts. Try again in {minutesLeft(wait)}.</Notice>
      ) : params.sent ? (
        <Notice tone="info">
          Sent. Check your inbox for a link to set a new password — it works once, for 30 minutes. Nothing there? Check
          spam; you can ask for another in 5 minutes.
        </Notice>
      ) : params.error === "send" ? (
        <Notice tone="error">The email couldn&apos;t be sent. Try again in a few minutes.</Notice>
      ) : null}

      {emailReady ? (
        <>
          <p className="text-sm text-text-secondary">
            We&apos;ll email a one-time link to set a new password to the address scan summaries go to (Settings →
            Email updates).
          </p>
          <form method="post" action="/login/forgot/submit">
            <button type="submit" disabled={wait > 0} className={`${submitClass} disabled:opacity-60`}>
              Email me a reset link
            </button>
          </form>
        </>
      ) : (
        <Notice tone="info">
          Email isn&apos;t set up, so a reset link can&apos;t be sent. Reset the login on the server instead — see
          &ldquo;Forgot the password&rdquo; in the README.
        </Notice>
      )}

      <p className="text-center text-sm">
        <Link href="/login" className="text-series-1 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
