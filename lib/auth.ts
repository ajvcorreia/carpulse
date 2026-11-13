import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { getCredentials, getLoginSettings, saveCredentials, type Credentials } from "@/lib/settings";

// Sign-in for the UI (the REST API keeps its X-API-Key, lib/api-auth.ts).
//
// Opt-in, as before: with no stored login and no AUTH_USERNAME/PASSWORD
// the app stays open. The first sign-in copies those two into the database
// (password as an scrypt hash); from then on the stored one is what counts,
// so it can be changed in Settings or reset by email. To start over from
// .env, run scripts/reset-login.mjs (see the README).
//
// Browsers hold a random session token in an HttpOnly cookie; the database
// keeps only its SHA-256 (auth_sessions), as it does for reset links.

export const SESSION_COOKIE = "carpulse_session";
export const MIN_PASSWORD_LENGTH = 10;
// Without "Keep me signed in": a browser-session cookie, and at most this
// long on the server.
const SHORT_SESSION_MS = 12 * 60 * 60_000;
// How often a visit pushes a session's expiry forward (and re-sends the
// cookie) — not on every request.
const REFRESH_EVERY_MS = 60 * 60_000;
const RESET_LINK_MS = 30 * 60_000;
// One reset email per this long, however often "Forgot password?" is used.
const RESET_EMAIL_EVERY_MS = 5 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const iso = (ms: number) => new Date(ms).toISOString();

function envCredentials() {
  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;
  return username && password ? { username, password } : null;
}

export function authEnabled() {
  return getCredentials() != null || envCredentials() != null;
}

// ---- passwords ----

const SCRYPT = { N: 16384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer, params = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { ...params, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [kind, N, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), { N: +N, r: +r, p: +p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The stored login, made from .env the first time it's needed.
async function currentCredentials(): Promise<Credentials | null> {
  const stored = getCredentials();
  if (stored) return stored;
  const env = envCredentials();
  if (!env) return null;
  const created = { username: env.username, passwordHash: await hashPassword(env.password) };
  saveCredentials(created);
  return created;
}

// Always hashes, even for a wrong username, so the answer takes as long
// either way.
export async function checkLogin(username: string, password: string) {
  const c = await currentCredentials();
  if (!c) return false;
  const userOk = timingSafeEqual(Buffer.from(sha256(username)), Buffer.from(sha256(c.username)));
  const passOk = await verifyPassword(password, c.passwordHash);
  return userOk && passOk;
}

export function passwordProblem(password: string, confirm: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

export async function setPassword(password: string) {
  const c = await currentCredentials();
  if (!c) throw new Error("Sign-in isn't set up.");
  saveCredentials({ username: c.username, passwordHash: await hashPassword(password) });
}

export function currentUsername() {
  return getCredentials()?.username ?? envCredentials()?.username ?? null;
}

// ---- sessions ----

export type Session = { id: string; persistent: boolean; expiresAt: string; refreshed: boolean };

function sessionExpiry(persistent: boolean, now: number) {
  return now + (persistent ? getLoginSettings().sessionDays * 24 * 60 * 60_000 : SHORT_SESSION_MS);
}

export function createSession(persistent: boolean, info: { ip: string; userAgent: string | null }) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = iso(sessionExpiry(persistent, now));
  getDb()
    .prepare(
      "insert into auth_sessions (id, persistent, created_at, last_seen_at, expires_at, ip, user_agent) values (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(sha256(token), persistent ? 1 : 0, iso(now), iso(now), expiresAt, info.ip, info.userAgent?.slice(0, 300) ?? null);
  return { token, persistent, expiresAt };
}

// The session a cookie belongs to, or null if it's unknown or expired. A
// "Keep me signed in" session's expiry moves forward with use (at most
// once an hour) — `refreshed` says the cookie should be sent again.
export function validateSession(token: string, now = Date.now()): Session | null {
  const db = getDb();
  const row = db
    .prepare("select id, persistent, last_seen_at, expires_at from auth_sessions where id = ?")
    .get(sha256(token)) as { id: string; persistent: number; last_seen_at: string; expires_at: string } | undefined;
  if (!row || Date.parse(row.expires_at) <= now) return null;
  const persistent = row.persistent === 1;
  if (!persistent || now - Date.parse(row.last_seen_at) < REFRESH_EVERY_MS) {
    return { id: row.id, persistent, expiresAt: row.expires_at, refreshed: false };
  }
  const expiresAt = iso(sessionExpiry(true, now));
  db.prepare("update auth_sessions set last_seen_at = ?, expires_at = ? where id = ?").run(iso(now), expiresAt, row.id);
  return { id: row.id, persistent, expiresAt, refreshed: true };
}

export function deleteSession(token: string) {
  getDb().prepare("delete from auth_sessions where id = ?").run(sha256(token));
}

// Signs out every browser — except `keepToken`'s, when given.
export function deleteAllSessions(keepToken?: string) {
  getDb()
    .prepare("delete from auth_sessions where id <> ?")
    .run(keepToken ? sha256(keepToken) : "");
}

export function countSessions() {
  const db = getDb();
  db.prepare("delete from auth_sessions where expires_at <= ?").run(iso(Date.now()));
  return (db.prepare("select count(*) as n from auth_sessions").get() as { n: number }).n;
}

// Cookie attributes. `Secure` only over HTTPS (Cloudflare says so in
// X-Forwarded-Proto / CF-Visitor), or a browser on plain http on the LAN
// would drop the cookie and never stay signed in.
export function sessionCookie(token: string, persistent: boolean, expiresAt: string, headers: Headers) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(headers),
    path: "/",
    ...(persistent ? { expires: new Date(expiresAt) } : {}),
  };
}

export function isHttps(headers: Headers) {
  return (
    headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ||
    (headers.get("cf-visitor") ?? "").includes('"https"')
  );
}

// ---- reset links ----

// A new one-time link token, valid for RESET_LINK_MS — or null when one
// was made too recently (so the button can't be used to flood the inbox).
// Making one cancels any earlier, unused link.
export function createResetToken(now = Date.now()): string | null {
  const db = getDb();
  const last = db.prepare("select max(created_at) as at from auth_reset_tokens").get() as { at: string | null };
  if (last.at && now - Date.parse(last.at) < RESET_EMAIL_EVERY_MS) return null;
  const token = newToken();
  db.prepare("delete from auth_reset_tokens where used_at is null or expires_at <= ?").run(iso(now));
  db.prepare("insert into auth_reset_tokens (id, created_at, expires_at) values (?, ?, ?)").run(
    sha256(token),
    iso(now),
    iso(now + RESET_LINK_MS)
  );
  return token;
}

export function resetTokenValid(token: string, now = Date.now()) {
  const row = getDb()
    .prepare("select expires_at, used_at from auth_reset_tokens where id = ?")
    .get(sha256(token)) as { expires_at: string; used_at: string | null } | undefined;
  return !!row && !row.used_at && Date.parse(row.expires_at) > now;
}

// Marks the link used; false if it wasn't valid (already used, expired,
// or never issued).
export function consumeResetToken(token: string, now = Date.now()) {
  const result = getDb()
    .prepare("update auth_reset_tokens set used_at = ? where id = ? and used_at is null and expires_at > ?")
    .run(iso(now), sha256(token), iso(now));
  return result.changes === 1;
}

// Only same-site paths, so ?next= can't send someone off to another site.
export function safeNextPath(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}
