import Link from "next/link";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-semibold">
            DubbizleWatch
          </Link>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
