// The ticked-off checklist of a listing check — used by the live scan page
// (components/LiveScanView.tsx) and the add-car form (components/NewCarForm.tsx).

export type Step = {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  ms?: number;
  detail?: string;
};

// Tenths under 10 s, where most steps land.
function stepTime(ms: number) {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  const whole = Math.round(s);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${(whole % 60).toString().padStart(2, "0")} s`;
}

function StepBox({ state }: { state: Step["state"] }) {
  const base = "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none";
  if (state === "done") return <span className={`${base} border-good bg-good text-white`}>✓</span>;
  if (state === "failed") return <span className={`${base} border-critical bg-critical text-white`}>✕</span>;
  if (state === "running")
    return (
      <span className={`${base} border-series-1`}>
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-series-1 border-t-transparent" />
      </span>
    );
  if (state === "skipped") return <span className={`${base} border-border text-text-muted`}>–</span>;
  return <span className={`${base} border-text-muted`} />;
}

// A check, step by step: a box that gets ticked as each finishes,
// what it found, and how long it took (counting up while it runs).
export function StepList({ steps, now }: { steps: Step[]; now: number }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step) => {
        const ms =
          step.state === "running" && step.startedAt ? now - new Date(step.startedAt).getTime() : step.ms;
        return (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              <StepBox state={step.state} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={
                  step.state === "pending" || step.state === "skipped"
                    ? "text-text-muted"
                    : step.state === "running"
                      ? "font-medium text-text-primary"
                      : "text-text-primary"
                }
              >
                {step.label}
                {step.state === "running" ? "…" : ""}
              </span>
              {step.detail ? (
                <span
                  className={`block break-words text-xs ${step.state === "failed" ? "text-critical" : "text-text-secondary"}`}
                >
                  {step.detail}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {ms != null && step.state !== "skipped" ? stepTime(ms) : step.state === "skipped" ? "skipped" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

