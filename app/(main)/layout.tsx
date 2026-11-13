import Link from "next/link";
import { connection } from "next/server";
import { authEnabled } from "@/lib/auth";
import { signOutAction } from "@/lib/auth-actions";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  // Whether sign-in is on is only known at run time (not while the image
  // is built), so no page under here may be prerendered.
  await connection();
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:max-w-[1440px]">
          <Link href="/" className="text-lg font-semibold">
            CarPulse
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-sm text-text-secondary hover:text-text-primary">
              Settings
            </Link>
            {authEnabled() ? (
              <form action={signOutAction}>
                <button type="submit" className="text-sm text-text-secondary hover:text-text-primary">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
