import { createHash, timingSafeEqual } from "node:crypto";
import { emailConfigProblem, sendEmail } from "@/lib/email";
import { getEmailSettings } from "@/lib/settings";

// Brute-force protection for the sign-in page and the API key: an address
// that gets MAX_FAILURES wrong within WINDOW_MS is turned away for
// BLOCK_MS — even with the right password — and the owner gets an email.
//
// Kept in memory, so a restart clears it; that's fine for blocks this
// short. On globalThis so every bundle in the server process (route
// handlers, server actions) shares one count.

const MAX_FAILURES = 3;
const WINDOW_MS = 10 * 60_000;
const BLOCK_MS = 10 * 60_000;
// A flood from many addresses mustn't grow the map without bound or fill
// the inbox.
const MAX_TRACKED = 10_000;
const MAX_ALERTS_PER_HOUR = 10;

type Entry = { failures: number[]; blockedUntil: number };
type Store = { entries: Map<string, Entry>; alerts: number[] };

const store: Store = ((globalThis as { __carpulseLockout?: Store }).__carpulseLockout ??= {
  entries: new Map(),
  alerts: [],
});

// The visitor's address. Behind Cloudflare that's CF-Connecting-IP, which
// Cloudflare sets itself (a client can't fake it through Cloudflare); the
// others are for reaching the app directly on the local network.
export function clientIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

// Compares in time that doesn't depend on how much of `given` is right.
export function safeEqual(given: string, expected: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Milliseconds until `ip` may try again; 0 when it isn't blocked.
export function blockedFor(ip: string, now = Date.now()) {
  const entry = store.entries.get(ip);
  return entry && entry.blockedUntil > now ? entry.blockedUntil - now : 0;
}

export function minutesLeft(ms: number) {
  const n = Math.max(1, Math.ceil(ms / 60_000));
  return `${n} minute${n === 1 ? "" : "s"}`;
}

function prune(now: number) {
  for (const [ip, e] of store.entries) {
    if (e.blockedUntil <= now && e.failures.every((t) => t <= now - WINDOW_MS)) store.entries.delete(ip);
  }
}

// Counts a wrong password / API key / reset link. Returns how many tries
// are left (0 = now blocked).
export function recordFailure(ip: string, what: string, now = Date.now()): number {
  if (store.entries.size >= MAX_TRACKED) prune(now);
  const entry = store.entries.get(ip) ?? { failures: [], blockedUntil: 0 };
  entry.failures = [...entry.failures.filter((t) => t > now - WINDOW_MS), now];
  store.entries.set(ip, entry);
  if (entry.failures.length < MAX_FAILURES) return MAX_FAILURES - entry.failures.length;

  entry.failures = [];
  entry.blockedUntil = now + BLOCK_MS;
  console.warn(`Blocked ${ip} for ${BLOCK_MS / 60_000} minutes after ${MAX_FAILURES} wrong ${what} attempts.`);
  void alertBlocked(ip, what, now);
  return 0;
}

export function recordSuccess(ip: string) {
  store.entries.delete(ip);
}

async function alertBlocked(ip: string, what: string, now: number) {
  store.alerts = store.alerts.filter((t) => t > now - 60 * 60_000);
  if (store.alerts.length >= MAX_ALERTS_PER_HOUR) return;
  const email = getEmailSettings();
  if (emailConfigProblem(email)) return;
  store.alerts.push(now);
  const when = new Date(now).toUTCString();
  const safeIp = ip.replace(/[^0-9a-fA-F:.]/g, "");
  const lines = [
    `CarPulse blocked ${safeIp} for ${BLOCK_MS / 60_000} minutes after ${MAX_FAILURES} wrong ${what} attempts (${when}).`,
    "If this was you, wait and try again. If not, someone is guessing — make sure the password is long (Settings → Sign-in).",
  ];
  try {
    await sendEmail(
      email,
      `CarPulse: blocked ${safeIp} after ${MAX_FAILURES} wrong ${what} attempts`,
      lines.join("\n\n"),
      lines.map((l) => `<p style="font-family:sans-serif;font-size:15px;line-height:22px">${l}</p>`).join("")
    );
  } catch (err) {
    console.error("Sending the lockout email failed:", err);
  }
}
