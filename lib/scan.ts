import { randomUUID } from "node:crypto";
import { getDb, withTransaction } from "@/lib/db/client";
import { sendEmail, type InlineImage } from "@/lib/email";
import { formatPrice } from "@/lib/format";
import { carHasPhotos, grabPhotosIfMissing, mainPhotoThumbnail } from "@/lib/photos";
import { callScraper, isGone, normalizeCurrency, type ScraperStep } from "@/lib/scraper";
import { getEmailSettings, getPhotoSettings, getScanSettings, type EmailSettings } from "@/lib/settings";

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
  // Struck out before a scheduled scan for staying removed too long (see
  // strikeOutLongRemoved). Absent from summaries saved before it existed.
  struckOut?: CarRef[];
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

export type LiveStepKey = ScraperStep | "compare" | "save";
export type LiveStep = {
  key: LiveStepKey;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  ms?: number;
  detail?: string;
};

// Every step of checking one listing, in order — the first six run in the
// scraper (scraper/server.py) and are streamed back as they happen.
const STEPS: [LiveStepKey, string][] = [
  ["queue", "Waiting for the scraper's browser"],
  ["load", "Loading the listing page"],
  ["settle", "Waiting out the site's bot check"],
  ["blocked", "Making sure it isn't a block page"],
  ["price", "Reading the price"],
  ["photos", "Finding the photos"],
  ["compare", "Comparing with the last price"],
  ["save", "Saving the photos"],
];

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
  // Filled in once the car's check starts.
  steps?: LiveStep[];
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
  return { priceChanges: [], removed: [], reactivated: [], struckOut: [], problems: [] };
}

export function hasChanges(s: ScanSummary) {
  return s.priceChanges.length + s.removed.length + s.reactivated.length + (s.struckOut?.length ?? 0) > 0;
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

export const STRIKE_OUT_AFTER_DAYS = 30;

// Scheduled scans only: a car whose ad has been gone for over a month is as
// good as sold, so it's struck out — hidden like any struck-out car and no
// longer checked, which is one less request to the site every scan. "Remove
// strike-out" on its card brings it back. removed_at is kept by triggers
// (lib/db/migrations.ts, 0007_removed_at).
function strikeOutLongRemoved(db: ReturnType<typeof getDb>, summary: ScanSummary) {
  const cutoff = new Date(Date.now() - STRIKE_OUT_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const reason = `Removed for over ${STRIKE_OUT_AFTER_DAYS} days`;
  withTransaction(db, () => {
    const cars = db
      .prepare(
        "select id, url, make, model, year, is_removed from cars where is_removed = 1 and is_struck_out = 0 and removed_at < ?"
      )
      .all(cutoff) as CarRow[];
    const strike = db.prepare("update cars set is_struck_out = 1, strike_out_reason = ? where id = ?");
    for (const car of cars) {
      strike.run(reason, car.id);
      summary.struckOut?.push(carRef(car));
    }
  });
}

// How one car's check went, for the live view. `blocked` means the site's
// bot protection refused the request, so the run can back off from it.
type Outcome = { status: LiveCarStatus; detail: string; blocked?: boolean; change?: number; photos?: number };

// Ticks off one car's steps as they happen, timing each.
function stepTracker(liveCar: LiveCar) {
  const steps: LiveStep[] = STEPS.map(([key, label]) => ({ key, label, state: "pending" }));
  liveCar.steps = steps;
  const find = (key: LiveStepKey) => steps.find((s) => s.key === key)!;
  const start = (key: LiveStepKey) => {
    Object.assign(find(key), { state: "running", startedAt: new Date().toISOString() });
  };
  const finish = (key: LiveStepKey, state: "done" | "failed" | "skipped", detail?: string) => {
    const step = find(key);
    step.state = state;
    if (step.startedAt) step.ms = Date.now() - Date.parse(step.startedAt);
    if (detail) step.detail = detail;
  };
  return {
    start,
    finish,
    // Runs a step that starts and ends on our side, timed.
    run: <T>(key: LiveStepKey, fn: () => T) => {
      start(key);
      return fn();
    },
    // A scraper that doesn't stream (an older image) only says it's done.
    scraperDone() {
      for (const s of steps.slice(0, 6)) if (s.state === "pending" || s.state === "running") finish(s.key, "done");
    },
    // Whatever didn't get to run: the one in flight failed (or finished, if
    // the check went fine), the rest were skipped.
    close(ok: boolean, detail?: string) {
      for (const s of steps) {
        if (s.state === "running") finish(s.key, ok ? "done" : "failed", ok ? undefined : detail);
        else if (s.state === "pending") finish(s.key, "skipped");
      }
    },
  };
}

type Steps = ReturnType<typeof stepTracker>;

async function checkCar(car: CarRow, summary: ScanSummary, steps: Steps): Promise<Outcome> {
  const db = getDb();
  const ref = carRef(car);

  const result = await callScraper("/scrape", car.url, (key, state, detail) =>
    state === "start" ? steps.start(key) : steps.finish(key, state, detail)
  );
  if (!result.ok) {
    summary.problems.push({ ...ref, message: result.message });
    steps.close(false, result.message);
    return { status: "problem", detail: result.message, blocked: result.blocked };
  }
  steps.scraperDone();
  const { data } = result;

  const decided = steps.run("compare", (): Outcome & { compareNote: string } => {
    if (isGone(data)) {
      if (!car.is_removed) {
        db.prepare("update cars set is_removed = 1 where id = ?").run(car.id);
        summary.removed.push(ref);
        return { status: "removed", detail: "Listing is gone — marked removed.", compareNote: "Gone — marked removed" };
      }
      return { status: "unchanged", detail: "Still gone.", compareNote: "Still gone" };
    }

    // Only a price from the site's own structured data proves this is the live
    // listing — a text-regex hit could come from a "similar cars" widget on a
    // page that otherwise says nothing useful.
    if (data.price == null || data.source === "text") {
      const message = "Page loaded, but no price data was found on it.";
      if (!car.is_removed) {
        summary.problems.push({ ...ref, message });
        return { status: "problem", detail: message, compareNote: "No trustworthy price to compare" };
      }
      return { status: "unchanged", detail: "Still removed — no price on the page.", compareNote: "Still removed" };
    }

    const notes: string[] = [];
    let status: LiveCarStatus = "unchanged";
    if (car.is_removed) {
      db.prepare("update cars set is_removed = 0 where id = ?").run(car.id);
      summary.reactivated.push(ref);
      status = "reactivated";
      notes.push("Back on sale");
    }

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
      return { status: "problem", detail: message, compareNote: "Different currency — not saved" };
    }
    if (latest && latest.price === price) {
      notes.push(`No change — ${formatPrice(price, currency)}`);
      return { status, detail: notes.join(" · "), compareNote: "Same price" };
    }

    db.prepare(
      "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, date('now'))"
    ).run(randomUUID(), car.id, price, currency);
    summary.priceChanges.push({ ...ref, previous: latest?.price ?? null, price, currency });
    const change = latest
      ? `${formatPrice(latest.price, currency)} → ${formatPrice(price, currency)}`
      : formatPrice(price, currency);
    notes.push(change);
    return {
      status: "price",
      detail: notes.join(" · "),
      change: latest ? price - latest.price : undefined,
      compareNote: latest ? `Price changed — saved ${change}` : `First price saved — ${change}`,
    };
  });
  const { compareNote, ...outcome } = decided;
  steps.finish("compare", "done", compareNote);

  if (isGone(data)) {
    steps.finish("save", "skipped");
    return outcome;
  }
  // Off unless "Save listing photos" is on, and a no-op once the car has some.
  const skipReason = !data.images?.length
    ? "No photos on the listing"
    : !getPhotoSettings().enabled
      ? "Photo saving is off"
      : carHasPhotos(car.id)
        ? "Already saved"
        : null;
  if (skipReason) {
    steps.finish("save", "skipped", skipReason);
    return outcome;
  }
  steps.start("save");
  const photos = await grabPhotosIfMissing(car.id, data.images, car.url);
  const photoNote = `${photos} photo${photos === 1 ? "" : "s"} saved`;
  steps.finish("save", photos > 0 ? "done" : "failed", photos > 0 ? photoNote : "Couldn't download them");
  return photos > 0 ? { ...outcome, detail: `${outcome.detail} · ${photoNote}`, photos } : outcome;
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
  if (trigger === "schedule") {
    try {
      strikeOutLongRemoved(db, summary);
    } catch (err) {
      const message = `Couldn't strike out long-removed cars: ${err instanceof Error ? err.message : String(err)}`;
      summary.problems.push({ id: "", url: "", label: "Scan", message });
    }
  }
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
      const steps = stepTracker(liveCar);
      try {
        const outcome = await checkCar(car, summary, steps);
        const blocks = outcome.blocked ? (consecutiveBlocks.get(host) ?? 0) + 1 : 0;
        consecutiveBlocks.set(host, blocks);
        if (blocks >= MAX_CONSECUTIVE_BLOCKS && !live.blockedHosts.includes(host)) live.blockedHosts.push(host);
        Object.assign(liveCar, { status: outcome.status, detail: outcome.detail, change: outcome.change });
        live.photosSaved += outcome.photos ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Check failed.";
        summary.problems.push({ ...carRef(car), message });
        steps.close(false, message);
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

// What a scan email's card shows beyond the summary itself — looked up when
// the email goes out (see sendScanEmail). `photoCid` names the embedded
// thumbnail of the car's main photo.
export type EmailCarDetails = {
  km: number | null;
  spec: string | null;
  price: number | null;
  currency: string | null;
  photoCid: string | null;
};

type CardKind = "price" | "back" | "removed" | "struck" | "problem";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const GOOD = "#006300";
const BAD = "#d03b3b";
const MUTED = "#71717a";

// Big enough to hit with a thumb (~46px tall). Inline styles only — mail
// apps drop <style> blocks.
function emailButton(href: string, label: string, primary: boolean) {
  const colors = primary
    ? "background:#2a78d6;color:#ffffff;border:1px solid #2a78d6"
    : "background:#ffffff;color:#2a78d6;border:1px solid #c9d7ea";
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 0 0;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:600;line-height:20px;text-decoration:none;${colors}">${escapeHtml(label)}</a>`;
}

// One car: main photo on the left; name, mileage/spec, price and what
// changed on the right; buttons underneath.
function emailCard(
  car: CarRef,
  kind: CardKind,
  details: EmailCarDetails | undefined,
  link: string | null,
  change?: { previous: number | null; price: number; currency: string },
  message?: string
) {
  const href = link ?? car.url;
  const meta = [details?.km != null ? `${details.km.toLocaleString("en-US")} km` : null, details?.spec]
    .filter(Boolean)
    .join(" · ");

  const price = change ?? (details?.price != null ? { price: details.price, currency: details.currency ?? "AED" } : null);
  let note: string;
  if (kind === "price" && change && change.previous != null) {
    const drop = change.price < change.previous;
    note = `<span style="color:${drop ? GOOD : BAD};font-weight:600">${drop ? "▼" : "▲"} ${escapeHtml(
      formatPrice(Math.abs(change.price - change.previous), change.currency)
    )}</span> <span style="color:${MUTED}">from ${escapeHtml(formatPrice(change.previous, change.currency))}</span>`;
  } else if (kind === "price") {
    note = `<span style="color:${MUTED}">first price recorded</span>`;
  } else if (kind === "back") {
    note = `<span style="color:${GOOD};font-weight:600">● Back on sale</span>`;
  } else if (kind === "removed") {
    note = `<span style="color:${BAD};font-weight:600">● Removed</span> <span style="color:${MUTED}">· last price</span>`;
  } else if (kind === "struck") {
    note = `<span style="color:${MUTED};font-weight:600">● Struck out</span> <span style="color:${MUTED}">· removed for over ${STRIKE_OUT_AFTER_DAYS} days, no longer scanned</span>`;
  } else {
    note = `<span style="color:${BAD};font-weight:600">● Couldn't check</span> <span style="color:${MUTED}">· ${escapeHtml(message ?? "")}</span>`;
  }

  const faded = kind === "removed" || kind === "struck";
  const photo = details?.photoCid
    ? `<img src="cid:${details.photoCid}" width="120" height="90" alt="" style="display:block;width:120px;height:90px;border:0;border-radius:8px;${faded ? "opacity:.6;" : ""}">`
    : `<div style="width:120px;height:90px;border-radius:8px;background:#e4e4e7"></div>`;

  // A gone listing has no ad to view; without an app URL the car's own
  // button already goes to the ad.
  const buttons = link
    ? emailButton(link, "Open in CarPulse", true) + (faded ? "" : emailButton(car.url, "View ad ↗", false))
    : emailButton(car.url, "View ad ↗", true);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;border-collapse:separate">
<tr>
<td width="120" valign="top" style="padding:14px 0 0 14px"><a href="${escapeHtml(href)}">${photo}</a></td>
<td valign="top" style="padding:12px 14px 0 12px">
<a href="${escapeHtml(href)}" style="font-size:16px;font-weight:700;line-height:21px;color:#18181b;text-decoration:none">${escapeHtml(car.label)}</a>
${meta ? `<div style="margin-top:2px;font-size:13px;line-height:18px;color:${MUTED}">${escapeHtml(meta)}</div>` : ""}
${price ? `<div style="margin-top:4px;font-size:18px;font-weight:700;line-height:24px;color:#18181b">${escapeHtml(formatPrice(price.price, price.currency))}</div>` : ""}
<div style="font-size:13px;line-height:18px">${note}</div>
</td>
</tr>
<tr><td colspan="2" style="padding:12px 14px 14px">${buttons}</td></tr>
</table>`;
}

export function buildScanEmail(summary: ScanSummary, appUrl: string, cars: Record<string, EmailCarDetails> = {}) {
  const base = appUrl.replace(/\/$/, "");
  const appLink = (c: CarRef) => (base ? `${base}/?highlight=${c.id}` : null);
  const link = (c: CarRef) => appLink(c) ?? c.url;

  const sections: { title: string; lines: { car: CarRef; detail: string; card: string }[] }[] = [
    {
      title: "Price changes",
      lines: summary.priceChanges.map((c) => ({
        car: c,
        detail:
          c.previous != null
            ? `${formatPrice(c.previous, c.currency)} → ${formatPrice(c.price, c.currency)}`
            : formatPrice(c.price, c.currency),
        card: emailCard(c, "price", cars[c.id], appLink(c), c),
      })),
    },
    {
      title: "Back on sale",
      lines: summary.reactivated.map((c) => ({
        car: c,
        detail: "listing is live again",
        card: emailCard(c, "back", cars[c.id], appLink(c)),
      })),
    },
    {
      title: "Removed",
      lines: summary.removed.map((c) => ({
        car: c,
        detail: "listing is gone",
        card: emailCard(c, "removed", cars[c.id], appLink(c)),
      })),
    },
    {
      title: "Struck out",
      lines: (summary.struckOut ?? []).map((c) => ({
        car: c,
        detail: `removed for over ${STRIKE_OUT_AFTER_DAYS} days — no longer scanned`,
        card: emailCard(c, "struck", cars[c.id], appLink(c)),
      })),
    },
    {
      title: "Couldn't check",
      lines: summary.problems
        .filter((p) => p.id)
        .map((p) => ({ car: p, detail: p.message, card: emailCard(p, "problem", cars[p.id], appLink(p), undefined, p.message) })),
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

  const struck = summary.struckOut?.length ?? 0;
  const counts = [
    `${n} price change${n === 1 ? "" : "s"}`,
    `${summary.reactivated.length} back on sale`,
    `${summary.removed.length} removed`,
    ...(struck ? [`${struck} struck out`] : []),
  ].join(" · ");

  const body =
    sections.length === 0
      ? `<div style="padding:16px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;font-size:15px;color:#52525b">No changes found in this scan.</div>`
      : sections
          .map(
            (s) =>
              `<div style="padding:8px 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${escapeHtml(
                s.title
              )}</div>${s.lines.map((l) => l.card).join("")}`
          )
          .join("");

  const html = `<div style="margin:0;padding:16px 10px;background:#f4f4f5;font-family:${FONT}">
<div style="max-width:600px;margin:0 auto">
<div style="padding:4px 4px 12px">
<div style="font-size:20px;font-weight:700;color:#18181b">CarPulse scan</div>
<div style="margin-top:2px;font-size:15px;color:#52525b">${escapeHtml(counts)}</div>
</div>
${body}
${base ? `<div style="padding:8px 0 4px;text-align:center">${emailButton(base, "Open CarPulse", true).replace("margin:0 8px 0 0", "margin:0")}</div>` : ""}
</div>
</div>`;

  return { subject, text, html };
}

// Each card's mileage, spec and latest price, plus its main photo as an
// embedded thumbnail. A car whose details can't be read still gets a card,
// just without them.
export async function emailCarDetails(summary: ScanSummary) {
  const ids = Array.from(
    new Set(
      [
        ...summary.priceChanges,
        ...summary.reactivated,
        ...summary.removed,
        ...(summary.struckOut ?? []),
        ...summary.problems,
      ]
        .map((c) => c.id)
        .filter(Boolean)
    )
  );
  const db = getDb();
  const carRow = db.prepare("select km, spec from cars where id = ?");
  const priceRow = db.prepare(
    "select price, currency from price_history where car_id = ? order by recorded_at desc, created_at desc limit 1"
  );
  const cars: Record<string, EmailCarDetails> = {};
  const images: InlineImage[] = [];
  for (const id of ids) {
    const car = carRow.get(id) as { km: number | null; spec: string | null } | undefined;
    const price = priceRow.get(id) as { price: number; currency: string } | undefined;
    const thumb = await mainPhotoThumbnail(id);
    const photoCid = thumb ? `car-${id}@carpulse` : null;
    if (thumb && photoCid) images.push({ filename: `${id}.jpg`, content: thumb, cid: photoCid, contentType: "image/jpeg" });
    cars[id] = {
      km: car?.km ?? null,
      spec: car?.spec ?? null,
      price: price?.price ?? null,
      currency: price?.currency ?? null,
      photoCid,
    };
  }
  return { cars, images };
}

async function sendScanEmail(email: EmailSettings, summary: ScanSummary) {
  const { cars, images } = await emailCarDetails(summary);
  const { subject, text, html } = buildScanEmail(summary, email.appUrl, cars);
  await sendEmail(email, subject, text, html, images);
}
