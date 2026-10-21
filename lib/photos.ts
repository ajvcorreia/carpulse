import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { getDb, withTransaction } from "@/lib/db/client";
import { getPhotoSettings } from "@/lib/settings";

// Listing photos, downloaded once and kept locally — so they survive the ad
// being taken down, which is exactly when you'd want to look back at a car.
//
// The scraper only finds the URLs (scraper/details.py, extract_images); the
// download happens here, straight from the site's image CDN. Files live next
// to the database (same volume in Docker), one folder per car; the
// car_photos table holds their order and type.

// Same reasoning as DB_PATH in lib/db/client.ts: statically scoped to
// <cwd>/data so build-time file tracing doesn't sweep in the whole project.
const PHOTOS_DIR = process.env.PHOTOS_DIR || join(process.cwd(), "data", "photos");

const MAX_PHOTOS = 40;
const MAX_BYTES = 15 * 1024 * 1024;
const PARALLEL_DOWNLOADS = 4;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export function carHasPhotos(carId: string) {
  return getDb().prepare("select 1 from car_photos where car_id = ? limit 1").get(carId) != null;
}

// The URLs come from a scraped page, so don't let one point the app at its
// own network (the scraper sidecar, the Docker host, the LAN) — public image
// hosts only.
function isPublicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    return !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.|::1$|f[cd]|fe80)/i.test(host);
  }
  return host.includes(".") && !/\.(local|internal|localhost)$/i.test(host);
}

type Downloaded = { url: string; bytes: Buffer; contentType: string };

async function download(url: string, referer: string): Promise<Downloaded | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some image CDNs refuse requests that don't look like a browser
        // showing the listing page.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
        Referer: referer,
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!EXTENSIONS[contentType]) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return { url, bytes, contentType };
  } catch {
    return null;
  }
}

// Downloads `urls` (in gallery order) and stores them as the car's photos.
// Returns how many were saved. Failed downloads are skipped, not fatal.
async function savePhotos(carId: string, urls: string[], referer: string): Promise<number> {
  const wanted = Array.from(new Set(urls.filter(isPublicHttpUrl))).slice(0, MAX_PHOTOS);
  const results: (Downloaded | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_DOWNLOADS, wanted.length) }, async () => {
      while (next < wanted.length) {
        const i = next++;
        results[i] = await download(wanted[i], referer);
      }
    })
  );

  // The same picture at two URLs (a site listing its cover photo twice).
  const seen = new Set<string>();
  const photos = results.filter((r): r is Downloaded => {
    if (!r) return false;
    const hash = createHash("sha1").update(r.bytes).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
  if (photos.length === 0) return 0;

  const rows = photos.map((p, position) => {
    const id = randomUUID();
    return { ...p, id, position, file: `${carId}/${id}.${EXTENSIONS[p.contentType]}` };
  });
  await mkdir(/* turbopackIgnore: true */ join(PHOTOS_DIR, carId), { recursive: true });
  for (const r of rows) await writeFile(/* turbopackIgnore: true */ join(PHOTOS_DIR, r.file), r.bytes);

  const db = getDb();
  const saved = withTransaction(db, () => {
    // Two checks of the same car racing (a scan and a button click) — the
    // first one to finish wins; the loser's files are cleaned up below.
    // Also covers the car having been merged away mid-download.
    if (carHasPhotos(carId)) return false;
    if (!db.prepare("select 1 from cars where id = ?").get(carId)) return false;
    const insert = db.prepare(
      "insert into car_photos (id, car_id, position, file, content_type, source_url) values (?, ?, ?, ?, ?, ?)"
    );
    for (const r of rows) insert.run(r.id, carId, r.position, r.file, r.contentType, r.url);
    return true;
  });
  if (!saved) {
    await deletePhotoFiles(rows.map((r) => r.file));
    return 0;
  }
  return rows.length;
}

// Called wherever a listing page has just been read and trusted (structured
// price data, not gone): saves its photos if the option is on and the car
// doesn't have any yet. Never throws — photos are a bonus on top of a price
// check, not a reason for one to fail.
export async function grabPhotosIfMissing(carId: string, urls: string[] | undefined, listingUrl: string) {
  if (!urls?.length || !getPhotoSettings().enabled || carHasPhotos(carId)) return 0;
  try {
    return await savePhotos(carId, urls, listingUrl);
  } catch (err) {
    console.error(`Saving photos for car ${carId} failed:`, err);
    return 0;
  }
}

export function countCarsWithPhotos(): number {
  return (getDb().prepare("select count(distinct car_id) as n from car_photos").get() as { n: number }).n;
}

export function getPhotoFiles(carId: string): string[] {
  return (getDb().prepare("select file from car_photos where car_id = ?").all(carId) as { file: string }[]).map(
    (r) => r.file
  );
}

export function photoFileExists(file: string) {
  return existsSync(/* turbopackIgnore: true */ join(PHOTOS_DIR, file));
}

export async function deletePhotoFiles(files: string[]) {
  const dirs = new Set<string>();
  for (const file of files) {
    await rm(/* turbopackIgnore: true */ join(PHOTOS_DIR, file), { force: true }).catch(() => {});
    dirs.add(dirname(file));
  }
  // Drop a car's folder once it's empty (rmdir refuses, harmlessly, if not).
  for (const dir of dirs) await rmdir(/* turbopackIgnore: true */ join(PHOTOS_DIR, dir)).catch(() => {});
}

export async function readPhoto(id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = getDb().prepare("select file, content_type from car_photos where id = ?").get(id) as
    | { file: string; content_type: string }
    | undefined;
  if (!row) return null;
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ join(PHOTOS_DIR, row.file));
    return { bytes, contentType: row.content_type };
  } catch {
    return null;
  }
}
