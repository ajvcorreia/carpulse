"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { runScanNowAction, stopScanAction } from "@/lib/settings-actions";
import type { LiveCar, LiveCarStatus, LiveScan } from "@/lib/scan";

type LiveState = { running: boolean; scan: LiveScan | null };

const POLL_MS = 2000;

const STATUS: Record<LiveCarStatus, { label: string; className: string }> = {
  waiting: { label: "Waiting", className: "border-border text-text-muted" },
  checking: { label: "Checking", className: "border-series-1 bg-series-1 text-white animate-pulse" },
  unchanged: { label: "No change", className: "border-border text-text-secondary" },
  price: { label: "Price change", className: "border-series-1 text-series-1" },
  removed: { label: "Removed", className: "border-critical text-critical" },
  reactivated: { label: "Back on sale", className: "border-good text-good" },
  problem: { label: "Couldn't check", className: "border-critical text-critical" },
  skipped: { label: "Skipped", className: "border-critical text-critical" },
};

const RUN_STATUS: Record<LiveScan["status"], string> = {
  running: "Running",
  done: "Finished",
  cancelled: "Stopped",
  failed: "Failed",
  interrupted: "Interrupted",
};

type Filter = "all" | "changes" | "problems";

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${sec.toString().padStart(2, "0")} s`;
  return `${sec} s`;
}

function clock(iso: string, timezone: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "good" | "critical" | "accent" }) {
  const color =
    value === 0
      ? "text-text-muted"
      : tone === "good"
        ? "text-good"
        : tone === "critical"
          ? "text-critical"
          : tone === "accent"
            ? "text-series-1"
            : "text-text-primary";
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-text-secondary">{label}</p>
    </div>
  );
}

function CarRow({ car, index, current, ended }: { car: LiveCar; index: number; current: boolean; ended: boolean }) {
  // A car the run never got to, once it has stopped.
  const status = ended && car.status === "waiting" ? { ...STATUS.waiting, label: "Not checked" } : STATUS[car.status];
  return (
    <li
      id={current ? "scan-current" : undefined}
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm ${current ? "bg-highlight" : ""}`}
    >
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-muted">{index + 1}</span>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
      <span className="min-w-0 flex-1">
        <Link href={`/?highlight=${encodeURIComponent(car.id)}`} className="font-medium hover:underline">
          {car.label}
        </Link>{" "}
        <span className="text-xs text-text-muted">{car.host}</span>
        {car.detail ? (
          <span className="block text-xs text-text-secondary">
            {car.change != null && car.change !== 0 ? (
              <span className={car.change < 0 ? "text-good" : "text-critical"}>{car.change < 0 ? "▼ " : "▲ "}</span>
            ) : null}
            {car.detail}
          </span>
        ) : null}
      </span>
      {car.seconds != null ? <span className="shrink-0 text-xs tabular-nums text-text-muted">{car.seconds} s</span> : null}
    </li>
  );
}

// The live scan page: polls the running scan's in-memory state (lib/scan.ts
// getLiveScan, via /scan/live) and shows what it's doing right now, its
// progress, and every car's result as it comes in.
export function LiveScanView({ initial, timezone }: { initial: LiveState; timezone: string }) {
  const [state, setState] = useState<LiveState>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { running, scan } = state;

  // Poll while a scan runs; slowly otherwise, so a scheduled scan that starts
  // while the page is open shows up on its own.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/scan/live", { cache: "no-store" });
        if (res.ok && !cancelled) setState(await res.json());
      } catch {
        // Network blip — the next poll tries again.
      }
    }
    const timer = setInterval(poll, running ? POLL_MS : 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running]);

  // Ticks the countdown and elapsed clocks between polls.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const counts = useMemo(() => {
    const c: Record<LiveCarStatus, number> = {
      waiting: 0,
      checking: 0,
      unchanged: 0,
      price: 0,
      removed: 0,
      reactivated: 0,
      problem: 0,
      skipped: 0,
    };
    for (const car of scan?.cars ?? []) c[car.status]++;
    return c;
  }, [scan]);

  function act(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      try {
        const res = await fetch("/scan/live", { cache: "no-store" });
        if (res.ok) setState(await res.json());
      } catch {
        // The regular poll catches up.
      }
    });
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      {running ? (
        <button
          type="button"
          onClick={() => act(stopScanAction)}
          disabled={pending || scan?.stopping}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:border-critical hover:text-critical disabled:opacity-60"
        >
          {scan?.stopping ? "Stopping after this car…" : "Stop scan"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => act(runScanNowAction)}
          disabled={pending}
          className="rounded-lg bg-series-1 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Run scan now
        </button>
      )}
      {error ? <span className="text-sm text-critical">{error}</span> : null}
    </div>
  );

  if (!scan) {
    return (
      <div className="space-y-4 rounded-lg border border-border p-4">
        <p className="text-sm text-text-secondary">
          No scan is running. This page fills in as soon as one starts — scheduled, or from the button below.
        </p>
        {controls}
      </div>
    );
  }

  const startedMs = new Date(scan.startedAt).getTime();
  const endMs = scan.finishedAt ? new Date(scan.finishedAt).getTime() : now;
  const elapsed = endMs - startedMs;
  const percent = scan.total ? Math.round((scan.checked / scan.total) * 100) : 0;
  const remaining = scan.total - scan.checked;
  const eta = running && scan.checked > 0 && remaining > 0 ? (elapsed / scan.checked) * remaining : null;
  const current = scan.currentIndex != null ? scan.cars[scan.currentIndex] : null;
  const pauseLeft = scan.phaseUntil ? new Date(scan.phaseUntil).getTime() - now : 0;
  const pauseTotal = scan.phaseUntil ? new Date(scan.phaseUntil).getTime() - new Date(scan.phaseSince).getTime() : 0;
  const nextCar = scan.currentIndex != null ? scan.cars[scan.currentIndex + 1] : null;

  const shown = scan.cars
    .map((car, index) => ({ car, index }))
    .filter(({ car }) =>
      filter === "changes"
        ? car.status === "price" || car.status === "removed" || car.status === "reactivated"
        : filter === "problems"
          ? car.status === "problem" || car.status === "skipped"
          : true
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${running ? "animate-pulse bg-good" : scan.status === "done" ? "bg-text-muted" : "bg-critical"}`}
          />
          <span className="font-medium text-text-primary">{RUN_STATUS[scan.status]}</span>
          <span>
            · {scan.trigger === "schedule" ? "scheduled" : "manual"} · started {clock(scan.startedAt, timezone)}
            {scan.finishedAt ? ` · ended ${clock(scan.finishedAt, timezone)}` : ""}
          </span>
        </div>
        {controls}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-3xl font-semibold tabular-nums">
            {scan.checked}
            <span className="text-lg text-text-muted"> / {scan.total} cars</span>
          </p>
          <p className="text-sm tabular-nums text-text-secondary">
            {percent}% · {duration(elapsed)} {running ? "so far" : "in total"}
            {eta != null ? ` · about ${duration(eta)} left` : ""}
          </p>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gridline">
          <div className="h-full rounded-full bg-series-1 transition-all duration-700" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {running ? (
        <div className="rounded-lg border border-series-1 bg-surface p-4">
          {scan.phase === "checking" && current ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-text-muted">Checking now</p>
              <p className="text-lg font-medium">
                <span className="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-series-1" />
                {current.label}
              </p>
              <p className="text-sm text-text-secondary">
                {current.host} · loading the listing for {duration(now - new Date(scan.phaseSince).getTime())}
              </p>
            </div>
          ) : scan.phase === "pausing" ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-text-muted">Pausing between cars</p>
              <p className="text-lg font-medium tabular-nums">
                Next check in {Math.max(0, Math.ceil(pauseLeft / 1000))} s
              </p>
              {nextCar ? (
                <p className="text-sm text-text-secondary">
                  Up next: {nextCar.label} · {nextCar.host}
                </p>
              ) : null}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gridline">
                <div
                  className="h-full rounded-full bg-text-muted transition-all duration-1000"
                  style={{
                    width: `${pauseTotal > 0 ? Math.min(100, Math.max(0, (1 - pauseLeft / pauseTotal) * 100)) : 0}%`,
                  }}
                />
              </div>
            </div>
          ) : scan.phase === "emailing" ? (
            <p className="text-lg font-medium">Sending the summary email…</p>
          ) : (
            <p className="text-lg font-medium">Starting…</p>
          )}
          {scan.stopping ? <p className="mt-2 text-sm text-critical">Stopping after the current car…</p> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Price changes" value={scan.summary.priceChanges.length} tone="accent" />
        <Tile label="Back on sale" value={scan.summary.reactivated.length} tone="good" />
        <Tile label="Marked removed" value={scan.summary.removed.length} tone="critical" />
        <Tile label="Couldn't check" value={scan.summary.problems.length} tone="critical" />
        <Tile label="Photos saved" value={scan.photosSaved} />
        <Tile label="No change" value={counts.unchanged} />
      </div>

      {scan.blockedHosts.length > 0 ? (
        <p className="rounded-lg border border-critical px-3 py-2 text-sm text-critical">
          {scan.blockedHosts.join(", ")} kept blocking the scanner — the rest of{" "}
          {scan.blockedHosts.length === 1 ? "its" : "their"} cars are skipped this run.
        </p>
      ) : null}
      {scan.summary.emailSent ? <p className="text-sm text-text-secondary">Summary emailed.</p> : null}
      {scan.summary.emailError ? <p className="text-sm text-critical">Email failed: {scan.summary.emailError}</p> : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", `All (${scan.cars.length})`],
              ["changes", `Changes (${counts.price + counts.removed + counts.reactivated})`],
              ["problems", `Problems (${counts.problem + counts.skipped})`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs ${filter === key ? "border-series-1 bg-series-1 text-white" : "border-border text-text-secondary hover:border-series-1"}`}
            >
              {label}
            </button>
          ))}
          {running && current ? (
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setTimeout(
                  () => document.getElementById("scan-current")?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  0
                );
              }}
              className="text-xs text-series-1 hover:underline"
            >
              Jump to current car
            </button>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing here yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map(({ car, index }) => (
              <CarRow
                key={car.id}
                car={car}
                index={index}
                current={running && index === scan.currentIndex}
                ended={!running}
              />
            ))}
          </ul>
        )}
        {!running && scan.status !== "done" && counts.waiting > 0 ? (
          <p className="text-xs text-text-muted">{counts.waiting} cars weren&apos;t reached before the scan ended.</p>
        ) : null}
      </div>
    </div>
  );
}
