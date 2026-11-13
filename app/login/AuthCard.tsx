// The frame every sign-in page shares: a centered card, sized for a phone
// first. Plain HTML forms throughout — they work before any JavaScript
// loads, and post to route handlers rather than server actions (see
// proxy.ts for why).

export const inputClass =
  "w-full rounded-lg border border-border bg-page px-3 py-3 text-base outline-none focus:border-series-1";
export const submitClass = "w-full rounded-lg bg-series-1 px-4 py-3 text-base font-medium text-white";

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm space-y-6">
        <p className="text-center text-lg font-semibold">CarPulse</p>
        <div className="space-y-5 rounded-xl border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Notice({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-sm ${
        tone === "error" ? "border-critical/40 text-critical" : "border-border text-text-secondary"
      }`}
    >
      {children}
    </p>
  );
}

export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
