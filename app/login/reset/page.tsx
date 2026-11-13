import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, MIN_PASSWORD_LENGTH, resetTokenValid } from "@/lib/auth";
import { blockedFor, clientIp, minutesLeft } from "@/lib/lockout";
import { AuthCard, Field, inputClass, Notice, submitClass } from "../AuthCard";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ERRORS: Record<string, string> = {
  short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "The two passwords don't match.",
};

export default async function ResetPage({ searchParams }: { searchParams: Params }) {
  if (!authEnabled()) redirect("/");
  const params = await searchParams;
  const token = one(params.token) ?? "";
  const error = one(params.error);
  const wait = blockedFor(clientIp(await headers()));

  if (wait) {
    return (
      <AuthCard title="Set a new password">
        <Notice tone="error">Too many wrong attempts. Try again in {minutesLeft(wait)}.</Notice>
      </AuthCard>
    );
  }

  if (!resetTokenValid(token)) {
    return (
      <AuthCard title="Link expired">
        <Notice tone="error">
          This reset link has already been used, has expired (they last 30 minutes), or was replaced by a newer one.
        </Notice>
        <Link href="/login/forgot" className={`${submitClass} block text-center`}>
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password">
      {error && ERRORS[error] ? <Notice tone="error">{ERRORS[error]}</Notice> : null}
      <p className="text-sm text-text-secondary">
        At least {MIN_PASSWORD_LENGTH} characters — a long passphrase or one from a password manager is best. Every
        other device will be signed out.
      </p>
      <form method="post" action="/login/reset/submit" className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field id="password" label="New password">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field id="confirm" label="New password again">
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            className={inputClass}
          />
        </Field>
        <button type="submit" className={submitClass}>
          Save and sign in
        </button>
      </form>
    </AuthCard>
  );
}
