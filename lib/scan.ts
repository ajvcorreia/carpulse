import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { sendEmail } from "@/lib/email";
import { formatPrice } from "@/lib/format";
import { grabPhotosIfMissing } from "@/lib/photos";
import { callScraper, isGone, normalizeCurrency } from "@/lib/scraper";
import { getEmailSettings, getScanSettings, type EmailSettings } from "@/lib/settings";

// Checks every tracked car's listing in one pass: removed cars whose listing
// is live again get reactivated, active cars whose listing is gone get marked
// removed, and price changes get logged — the same decisions a person would
// make clicking "Check listing for updates" on each card, with a random pause
// between cars so it doesn't hammer a site at a machine-regular rhythm.
//
// Runs inside the Next server process (kicked off by lib/scheduler.ts or the
// settings page's "Run now"). Its in-memory state lives on globalThis, not
// module scope: Next can load this module into more than one bundle (the
// instrumentation hook vs. server actions), and they must agree on whether a
// scan is running.

type CarRef = { id: string; label: string; url: string };

export type ScanSummary = {
  priceChanges: (CarRef & { previous: number | null; price: number; currency: string })[];
  removed: CarRef[];
  reactivated: CarRef[];
  // Checked, but nothing could be concluded (blocked, no price found…).
  problems: (CarRef & { message: string })[];
  emailSent?: boolean;
  emailError?: string;
};

export type ScanRunRow = {
  id: string;
  trigger: "schedule" | "manual";
  status: "running" | "done" | "cancelled" | "failed" | "interrupted";
  started_at: string;
  finished_at: string | null;
  total: number;
  checked: number;
  summary: string | null;
};

const MAX_CONSECUTIVE_BLOCKS = 3;

// What the live scan page (/scan) shows: every car in the run with how its
// check went, plus what the run is doing right now. In memory only — the
// scan_runs row keeps the lasting record.
export type LiveCarStatus =
  | "waiting"
  | "checking"
  | "unchanged"
  | "price"
  | "removed"
  | "reactivated"
  | "problem"
  | "skipped";

export type LiveCar = {
  id: string;
  label: string;
  url: string;
  host: string;
  status: LiveCarStatus;
  detail?: string;
  // New price minus the previous one, when a price change was logged.
  change?: number;
  // How long the check took.
  seconds?: number;
};

export type LiveScan = {
  runId: string;
  trigger: ScanRunRow["trigger"];
  status: ScanRunRow["status"];
  startedAt: string;
  finishedAt: string | null;
  // Checking a car, pausing between cars, sending the summary email, or done.
  phase: "starting" | "checking" | "pausing" | "emailing" | "finished";
  phaseSince: string;
  // End of the current pause.
  phaseUntil: string | null;
  // Index into cars of the one being checked (or just checked, while pausing).
  currentIndex: number | null;
  total: number;
  checked: number;
  photosSaved: number;
  // Sites skipped for the rest of the run after blocking it repeatedly.
  blockedHosts: string[];
  stopping: boolean;
  summary: ScanSummary;
  cars: LiveCar[];
};

type ScanState = { runId: string; cancel: boolean; live: LiveScan } | null;
// __carpulseLastLive keeps the last finished run's live view, so the page can
// still show how it ended.
const g = globalThis as { __carpulseScan?: ScanState; __carpulseLastLive?: LiveScan };

export function isScanRunning() {
  return g.__carpulseScan != null;
}

// The running scan's live view, or the last one since the app started.
export function getLiveScan(): { running: boolean; scan: LiveScan | null } {
  const state = g.__carpulseScan;
  const live = state?.live ?? g.__carpulseLastLive ?? null;
  return {
    running: state != null,
    scan: live ? { ...structuredClone(live), stopping: state?.cancel ?? false } : null,
  };
}

export function requestScanStop() {
  if (g.__carpulseScan) g.__carpulseScan.cancel = true;
}

export function getRecentScanRuns(limit = 10): ScanRunRow[] {
  const rows = getDb().prepare("select * from scan_runs order by started_at desc limit ?").all(limit);
  // node:sqlite rows have a null prototype, which Next refuses to pass to a
  // client component — copy each into a plain object.
  return rows.map((r) => ({ ...r }) as ScanRunRow);
}

// A run left "running" by a previous process (container restart mid-scan)
// will never finish — say so instead of showing it as running forever.
export function markInterruptedRuns() {
  getDb()
    .prepare("update scan_runs set status = 'interrupted', finished_at = ? where status = 'running'")
    .run(new Date().toISOString());
}

function emptySummary(): ScanSummary {
  return { priceChanges: [], removed: [], reactivated: [], problems: [] };
}

export function hasChanges(s: ScanSummary) {
  return s.priceChanges.length + s.removed.length + s.reactivated.length > 0;
}

type CarRow = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  is_removed: number;
};

function carRef(car: CarRow): CarRef {
  return { id: car.id, url: car.url, label: `${car.year} ${car.make} ${car.model}` };
}

// How one car's check went, for the live view. `blocked` means the site's
// bot protection refused the request, so the run can back off from it.
type Outcome = { status: LiveCarStatus; detail: string; blocked?: boolean; change?: number; photos?: number };

async function checkCar(car: CarRow, summary: ScanSummary): Promise<Outcome> {
  const db = getDb();
  const ref = carRef(car);

  const result = await callScraper("/scrape", car.url);
  if (!result.ok) {
    summary.problems.push({ ...ref, message: result.message });
    return { status: "problem", detail: result.message, blocked: result.blocked };
  }
  const { data } = result;

  if (isGone(data)) {
    if (!car.is_removed) {
      db.prepare("update cars set is_removed = 1 where id = ?").run(car.id);
      summary.removed.push(ref);
      return { status: "removed", detail: "Listing is gone — marked removed." };
    }
    return { status: "unchanged", detail: "Still gone." };
  }

  // Only a price from the site's own structured data proves this is the live
  // listing — a text-regex hit could come from a "similar cars" widget on a
  // page that otherwise says nothing useful.
  if (data.price == null || data.source === "text") {
    const message = "Page loaded, but no price data was found on it.";
    if (!car.is_removed) {
      summary.problems.push({ ...ref, message });
      return { status: "problem", detail: message };
    }
    return { status: "unchanged", detail: "Still removed — no price on the page." };
  }

  const notes: string[] = [];
  let status: LiveCarStatus = "unchanged";
  if (car.is_removed) {
    db.prepare("update cars set is_removed = 0 where id = ?").run(car.id);
    summary.reactivated.push(ref);
    status = "reactivated";
    notes.push("Back on sale");
  }

  // Off unless "Save listing photos" is on, and a no-op once the car has some.
  const photos = await grabPhotosIfMissing(car.id, data.images, car.url);
  const photoNote = photos > 0 ? [`${photos} photo${photos === 1 ? "" : "s"} saved`] : [];

  const latest = db
    .prepare(
      "select price, currency from price_history where car_id = ? order by recorded_at desc, created_at desc limit 1"
    )
    .get(car.id) as { price: number; currency: string } | undefined;
  const trackedCurrency = latest?.currency ?? "AED";
  const currency = normalizeCurrency(data.currency, trackedCurrency);
  const price = Math.round(data.price);

  if (currency !== trackedCurrency) {
    const message = `Listing shows ${formatPrice(price, currency)}, but it's tracked in ${trackedCurrency} — not saved.`;
    summary.problems.push({ ...ref, message });
    return { status: "problem", detail: [message, ...photoNote].join(" · "), photos };
  }
  if (latest && latest.price === price) {
    notes.push(`No change — ${formatPrice(price, currency)}`, ...photoNote);
    return { status, detail: notes.join(" · "), photos };
  }

  db.prepare(
    "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, date('now'))"
  ).run(randomUUID(), car.id, price, currency);
  summary.priceChanges.push({ ...ref, previous: latest?.price ?? null, price, currency });
  notes.push(
    latest ? `${formatPrice(latest.price, currency)} → ${formatPrice(price, currency)}` : formatPrice(price, currency),
    ...photoNote
  );
  return {
    status: "price",
    detail: notes.join(" · "),
    change: latest ? price - latest.price : undefined,
    photos,
  };
}

// Sleeps in 1s steps so "Stop" doesn't have to wait out a whole pause.
async function pause(seconds: number) {
  for (let i = 0; i < seconds && !g.__carpulseScan?.cancel; i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function randomPause(min: number, max: number) {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(lo, max);
  return lo + Math.round(Math.random() * (hi - lo));
}

// Starts a scan in the background and returns its run id straight away, or
// null when one is already running.
export function startScan(trigger: "schedule" | "manual"): string | null {
  if (g.__carpulseScan) return null;
  const runId = randomUUID();
  const now = new Date().toISOString();
  const live: LiveScan = {
    runId,
    trigger,
    status: "running",
    startedAt: now,
    finishedAt: null,
    phase: "starting",
    phaseSince: now,
    phaseUntil: null,
    currentIndex: null,
    total: 0,
    checked: 0,
    photosSaved: 0,
    blockedHosts: [],
    stopping: false,
    summary: emptySummary(),
    cars: [],
  };
  g.__carpulseScan = { runId, cancel: false, live };
  void runScan(runId, trigger, live).finally(() => {
    g.__carpulseLastLive = live;
    g.__carpulseScan = null;
  });
  return runId;
}

// Last two labels, so dubai.dubizzle.com and dubizzle.com count as one site.
function hostOf(url: string) {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return url;
  }
}

function setPhase(live: LiveScan, phase: LiveScan["phase"], until: Date | null = null) {
  live.phase = phase;
  live.phaseSince = new Date().toISOString();
  live.phaseUntil = until ? until.toISOString() : null;
}

async function runScan(runId: string, trigger: "schedule" | "manual", live: LiveScan) {
  const db = getDb();
  const settings = getScanSettings();
  const summary = live.summary;
  // Active cars first: price changes on cars still for sale matter most if
  // the run gets stopped partway. Struck-out cars are skipped — they've been
  // ruled out, and every check is another request to the site.
  const cars = db
    .prepare(
      "select id, url, make, model, year, is_removed from cars where is_struck_out = 0 order by is_removed, created_at desc"
    )
    .all() as CarRow[];

  db.prepare("insert into scan_runs (id, trigger, status, started_at, total) values (?, ?, 'running', ?, ?)").run(
    runId,
    trigger,
    new Date().toISOString(),
    cars.length
  );
  const saveProgress = db.prepare("update scan_runs set checked = ?, summary = ? where id = ?");
  live.total = cars.length;
  live.cars = cars.map((c) => ({ ...carRef(c), host: hostOf(c.url), status: "waiting" }));

  // Once a site starts refusing requests, more requests only extend the
  // block — after a few in a row, skip that site for the rest of the run.
  const consecutiveBlocks = new Map<string, number>();

  let status: ScanRunRow["status"] = "done";
  try {
    for (const [i, car] of cars.entries()) {
      if (g.__carpulseScan?.cancel) {
        status = "cancelled";
        break;
      }
      const host = hostOf(car.url);
      const liveCar = live.cars[i];
      if ((consecutiveBlocks.get(host) ?? 0) >= MAX_CONSECUTIVE_BLOCKS) {
        const message = `Skipped — ${host} was blocking the scanner.`;
        summary.problems.push({ ...carRef(car), message });
        Object.assign(liveCar, { status: "skipped", detail: message });
        live.checked = i + 1;
        saveProgress.run(i + 1, JSON.stringify(summary), runId);
        continue;
      }
      live.currentIndex = i;
      liveCar.status = "checking";
      setPhase(live, "checking");
      const startedAt = Date.now();
      try {
        const outcome = await checkCar(car, summary);
        const blocks = outcome.blocked ? (consecutiveBlocks.get(host) ?? 0) + 1 : 0;
        consecutiveBlocks.set(host, blocks);
        if (blocks >= MAX_CONSECUTIVE_BLOCKS && !live.blockedHosts.includes(host)) live.blockedHosts.push(host);
        Object.assign(liveCar, { status: outcome.status, detail: outcome.detail, change: outcome.change });
        live.photosSaved += outcome.photos ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Check failed.";
        summary.problems.push({ ...carRef(car), message });
        Object.assign(liveCar, { status: "problem", detail: message });
      }
      liveCar.seconds = Math.round((Date.now() - startedAt) / 1000);
      live.checked = i + 1;
      saveProgress.run(i + 1, JSON.stringify(summary), runId);
      if (i < cars.length - 1) {
        const seconds = randomPause(settings.minPauseSeconds, settings.maxPauseSeconds);
        setPhase(live, "pausing", new Date(Date.now() + seconds * 1000));
        await pause(seconds);
      }
    }
  } catch (err) {
    status = "failed";
    summary.problems.push({ id: "", url: "", label: "Scan", message: err instanceof Error ? err.message : String(err) });
  }

  const email = getEmailSettings();
  if (email.enabled && status !== "cancelled" && (!email.onlyWhenChanged || hasChanges(summary))) {
    setPhase(live, "emailing");
    try {
      await sendScanEmail(email, summary);
      summary.emailSent = true;
    } catch (err) {
      summary.emailError = err instanceof Error ? err.message : String(err);
    }
  }

  const finishedAt = new Date().toISOString();
  db.prepare("update scan_runs set status = ?, finished_at = ?, summary = ? where id = ?").run(
    status,
    finishedAt,
    JSON.stringify(summary),
    runId
  );
  live.status = status;
  live.finishedAt = finishedAt;
  live.currentIndex = null;
  setPhase(live, "finished");
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

export function buildScanEmail(summary: ScanSummary, appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  const link = (c: CarRef) => (base ? `${base}/?highlight=${c.id}` : c.url);

  const sections: { title: string; lines: { car: CarRef; detail: string }[] }[] = [
    {
      title: "Price changes",
      lines: summary.priceChanges.map((c) => ({
        car: c,
        detail:
          c.previous != null
            ? `${formatPrice(c.previous, c.currency)} → ${formatPrice(c.price, c.currency)}`
            : formatPrice(c.price, c.currency),
      })),
    },
    { title: "Back on sale", lines: summary.reactivated.map((c) => ({ car: c, detail: "listing is live again" })) },
    { title: "Removed", lines: summary.removed.map((c) => ({ car: c, detail: "listing is gone" })) },
    {
      title: "Couldn't check",
      lines: summary.problems.filter((p) => p.id).map((p) => ({ car: p, detail: p.message })),
    },
  ].filter((s) => s.lines.length > 0);

  const n = summary.priceChanges.length;
  const subject = `CarPulse: ${n} price change${n === 1 ? "" : "s"}, ${summary.reactivated.length} back on sale, ${
    summary.removed.length
  } removed`;

  const text =
    sections.length === 0
      ? "No changes found in this scan."
      : sections
          .map((s) => `${s.title}\n${s.lines.map((l) => `- ${l.car.label}: ${l.detail}\n  ${link(l.car)}`).join("\n")}`)
          .join("\n\n");

  const body =
    sections.length === 0
      ? "<p>No changes found in this scan.</p>"
      : sections
          .map(
            (s) =>
              `<h3 style="margin:16px 0 4px">${escapeHtml(s.title)}</h3><ul style="margin:0;padding-left:20px">${s.lines
                .map(
                  (l) =>
                    `<li><a href="${escapeHtml(link(l.car))}">${escapeHtml(l.car.label)}</a>: ${escapeHtml(l.detail)}</li>`
                )
                .join("")}</ul>`
          )
          .join("");

  return { subject, text, html: `<div style="font-family:sans-serif;font-size:14px">${body}</div>` };
}

async function sendScanEmail(email: EmailSettings, summary: ScanSummary) {
  const { subject, text, html } = buildScanEmail(summary, email.appUrl);
  await sendEmail(email, subject, text, html);
}
