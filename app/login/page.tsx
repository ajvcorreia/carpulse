import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled, safeNextPath, SESSION_COOKIE, validateSession } from "@/lib/auth";
import { blockedFor, clientIp, minutesLeft } from "@/lib/lockout";
import { AuthCard, Field, inputClass, Notice, submitClass } from "./AuthCard";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const next = safeNextPath(one(params.next));
  if (!authEnabled()) redirect(next);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && validateSession(token)) redirect(next);

  const wait = blockedFor(clientIp(await headers()));
  const error = one(params.error);
  const left = Number(one(params.left)) || 0;

  return (
    <AuthCard title="Sign in">
      {wait ? (
        <Notice tone="error">Too many wrong passwords. Try again in {minutesLeft(wait)}.</Notice>
      ) : error === "wrong" ? (
        <Notice tone="error">
          Wrong username or password.{" "}
          {left ? `${left} more ${left === 1 ? "try" : "tries"} before sign-in is blocked for 10 minutes.` : ""}
        </Notice>
      ) : one(params.signedout) ? (
        <Notice tone="info">You&apos;re signed out.</Notice>
      ) : null}

      <form method="post" action="/login/submit" className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field id="username" label="Username">
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field id="password" label="Password">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remember" defaultChecked className="h-4 w-4" />
          Keep me signed in
        </label>
        <button type="submit" disabled={wait > 0} className={`${submitClass} disabled:opacity-60`}>
          Sign in
        </button>
      </form>

      <p className="text-center text-sm">
        <Link href="/login/forgot" className="text-series-1 hover:underline">
          Forgot password?
        </Link>
      </p>
    </AuthCard>
  );
}
