// Runs once when the Next server starts. Starts the automatic-scan scheduler
// (lib/scheduler.ts) — Node runtime only, since it uses node:sqlite and
// long-lived timers.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
