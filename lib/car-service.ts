import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getDb, withTransaction } from "@/lib/db/client";
import { getCarsWithPrices } from "@/lib/data";
import { deletePhotoFiles, getPhotoFiles, grabPhotosIfMissing } from "@/lib/photos";
import { callScraper, isGone, normalizeCurrency, type ListingDetails } from "@/lib/scraper";
import { getPhotoSettings } from "@/lib/settings";

// The car operations behind both the UI's server actions (lib/actions.ts)
// and the key-gated REST API (app/api/**) — the native app talks to the
// latter, so every feature the dashboard offers has to be reachable from
// both. Plain module, not "use server": nothing here redirects or
// revalidates; callers do whichever of those fits them.

export type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };

export type CarFields = {
  url: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  cylinders: number | null;
  spec: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  ad_placed_at: string | null;
};

// Make/model/year/cylinders/spec/colors — what a merge (or a relist from the
// duplicate check) lets you pick per field from either car.
export type PickedDetails = Pick<
  CarFields,
  "make" | "model" | "year" | "cylinders" | "spec" | "exterior_color" | "interior_color"
>;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed");
}

// recordedAt null falls back to the column's own default (today) rather
// than needing two separate prepared statements per call site.
export function insertPricePoint(
  db: DatabaseSync,
  carId: string,
  price: number,
  recordedAt: string | null,
  currency = "AED"
) {
  db.prepare(
    "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, coalesce(?, date('now')))"
  ).run(randomUUID(), carId, price, currency, recordedAt);
}

// "Also listed at" — folds carBId's whole group into carAId's group (or
// creates a new group of just the two, if neither was already grouped).
// Symmetric in effect regardless of argument order: whichever of the two
// resolves to the pre-existing anchor keeps that role, and every member of
// the *other* group gets repointed onto it. Unlike relist/merge, nothing
// else about either car changes — no data is combined or discarded, so this
// is trivially reversible (see unlinkCarRecord below).
function linkCarIds(db: DatabaseSync, carAId: string, carBId: string) {
  if (carAId === carBId) return;

  const getCar = db.prepare("select id, group_id from cars where id = ?");
  const carA = getCar.get(carAId) as { id: string; group_id: string | null } | undefined;
  const carB = getCar.get(carBId) as { id: string; group_id: string | null } | undefined;
  if (!carA || !carB) throw new Error("One of those cars no longer exists.");

  const anchorA = carA.group_id ?? carA.id;
  const anchorB = carB.group_id ?? carB.id;
  if (anchorA === anchorB) return; // already in the same group

  const membersOfB = db.prepare("select id from cars where id = ? or group_id = ?").all(anchorB, anchorB) as {
    id: string;
  }[];

  const setGroup = db.prepare("update cars set group_id = ? where id = ?");
  for (const m of membersOfB) {
    if (m.id !== anchorA) setGroup.run(anchorA, m.id);
  }
}

// Same car, re-listed under a different URL, tends to keep the same make,
// model, and colors, with mileage that's crept up a little rather than
// changed wildly — so within 5% (or 1000km, whichever is larger, to avoid
// flagging near-zero-mileage cars over a handful of km) counts as "close".
const KM_CLOSENESS_RATIO = 0.05;
const KM_CLOSENESS_FLOOR = 1000;

function normalizeForCompare(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

type DuplicateCandidate = {
  id: string;
  url: string;
  make: string;
  model: string;
  year: number;
  km: number | null;
  cylinders: number | null;
  spec: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  ad_placed_at: string | null;
  is_removed: number;
};

export type PossibleDuplicate = Omit<DuplicateCandidate, "is_removed" | "km"> & {
  km: number;
  is_removed: boolean;
  latest_price: number | null;
  latest_currency: string | null;
};

export function findPossibleDuplicate(entry: {
  make: string;
  model: string;
  exteriorColor: string | null;
  interiorColor: string | null;
  km: number | null;
}): PossibleDuplicate | null {
  if (!entry.make || !entry.model || entry.km == null) return null;

  const db = getDb();
  const candidates = db
    .prepare(
      `select id, url, make, model, year, km, cylinders, spec, exterior_color, interior_color, ad_placed_at, is_removed
       from cars where make = ? collate nocase and model = ? collate nocase`
    )
    .all(entry.make, entry.model) as DuplicateCandidate[];

  for (const c of candidates) {
    if (c.km == null) continue;

    const colorsMatch =
      normalizeForCompare(entry.exteriorColor) === normalizeForCompare(c.exterior_color) &&
      normalizeForCompare(entry.interiorColor) === normalizeForCompare(c.interior_color);
    if (!colorsMatch) continue;

    const threshold = Math.max(KM_CLOSENESS_FLOOR, KM_CLOSENESS_RATIO * Math.max(entry.km, c.km));
    if (Math.abs(entry.km - c.km) <= threshold) {
      // Fetched only for the one matched candidate, not every candidate in
      // the loop — the existing-vs-new comparison shown to the user wants
      // its latest tracked price alongside the rest of its specs.
      const latest = db
        .prepare(
          "select price, currency from price_history where car_id = ? order by recorded_at desc, created_at desc limit 1"
        )
        .get(c.id) as { price: number; currency: string } | undefined;

      return {
        id: c.id,
        url: c.url,
        make: c.make,
        model: c.model,
        year: c.year,
        km: c.km,
        cylinders: c.cylinders,
        spec: c.spec,
        exterior_color: c.exterior_color,
        interior_color: c.interior_color,
        ad_placed_at: c.ad_placed_at,
        is_removed: Boolean(c.is_removed),
        latest_price: latest?.price ?? null,
        latest_currency: latest?.currency ?? null,
      };
    }
  }

  return null;
}

export async function createCarRecord(input: {
  fields: CarFields;
  price: number;
  currency?: string;
  recordedAt: string | null;
  // Set from the add-car flow's "Also listed elsewhere" duplicate-detection
  // option — tracks this as a genuinely new, independent car (own price
  // history, own removed/favorite status) but immediately links it to the
  // existing one so both show up as "also listed at" each other.
  alsoListedAtCarId?: string | null;
  // Photo URLs the "Fill from listing" pre-fill found (readListingDetails).
  photoUrls?: string[];
}): Promise<ServiceResult<{ id: string }>> {
  const { fields } = input;
  const db = getDb();
  const carId = randomUUID();

  try {
    withTransaction(db, () => {
      db.prepare(
        `insert into cars (id, url, make, model, year, km, cylinders, spec, exterior_color, interior_color, ad_placed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        carId,
        fields.url,
        fields.make,
        fields.model,
        fields.year,
        fields.km,
        fields.cylinders,
        fields.spec,
        fields.exterior_color,
        fields.interior_color,
        fields.ad_placed_at
      );

      insertPricePoint(db, carId, input.price, input.recordedAt, input.currency);

      if (input.alsoListedAtCarId) linkCarIds(db, carId, input.alsoListedAtCarId);
    });
  } catch (err) {
    return {
      ok: false,
      conflict: isUniqueViolation(err),
      error: isUniqueViolation(err)
        ? "That listing URL is already tracked."
        : err instanceof Error
          ? err.message
          : "Could not save the car.",
    };
  }

  await grabPhotosIfMissing(carId, input.photoUrls ?? [], fields.url);
  return { ok: true, id: carId };
}

// Same physical car, re-listed under a new URL (e.g. a removed ad reposted
// later) — merges into the existing car row instead of starting a fresh one,
// so its price history stays intact. The old URL/ad-placement date aren't
// discarded: they're archived to listing_history first, so the fact that it
// was previously listed elsewhere stays visible on the car's page.
export async function relistCarRecord(input: {
  existingCarId: string;
  fields: CarFields;
  price: number;
  recordedAt: string | null;
  photoUrls?: string[];
}): Promise<ServiceResult> {
  const { existingCarId, fields } = input;
  const db = getDb();

  try {
    withTransaction(db, () => {
      const previous = db.prepare("select url, ad_placed_at from cars where id = ?").get(existingCarId) as
        | { url: string; ad_placed_at: string | null }
        | undefined;
      if (!previous) throw new Error("That car no longer exists.");

      db.prepare(
        `update cars set url = ?, make = ?, model = ?, year = ?, km = ?, cylinders = ?, spec = ?,
         exterior_color = ?, interior_color = ?, ad_placed_at = ?,
         is_removed = 0, is_struck_out = 0, strike_out_reason = null
         where id = ?`
      ).run(
        fields.url,
        fields.make,
        fields.model,
        fields.year,
        fields.km,
        fields.cylinders,
        fields.spec,
        fields.exterior_color,
        fields.interior_color,
        fields.ad_placed_at,
        existingCarId
      );

      db.prepare(
        "insert into listing_history (id, car_id, previous_url, previous_ad_placed_at) values (?, ?, ?, ?)"
      ).run(randomUUID(), existingCarId, previous.url, previous.ad_placed_at);

      insertPricePoint(db, existingCarId, input.price, input.recordedAt);
    });
  } catch (err) {
    return {
      ok: false,
      conflict: isUniqueViolation(err),
      error: isUniqueViolation(err)
        ? "Another tracked car already has that URL."
        : err instanceof Error
          ? err.message
          : "Could not relist the car.",
    };
  }

  // Only fills in photos the car didn't have — a relist keeps its old ones.
  await grabPhotosIfMissing(existingCarId, input.photoUrls ?? [], fields.url);
  return { ok: true };
}

// Two already-tracked rows turn out to be the same car — unlike a relist
// (triggered by the add-flow's automatic duplicate check), this is a
// deliberate merge the user initiates from the dashboard, picking which of
// the two keeps its url/details as the "current" record. Nothing from the
// other car is discarded: its own current url/ad-placement date is archived
// to listing_history (same as a relist), its price_history and
// listing_history both get reassigned onto the kept car (exact (date,
// price) duplicates dropped rather than doubled up in the chart), and only
// then is its now-empty row deleted.
//
// url/ad_placed_at/km/price aren't independently pickable — they stay
// whatever they already are on the kept car, since they're inherently tied
// to "the current listing" rather than a detail you'd mix and match. Every
// other detail (make/model/year/cylinders/spec/colors) is: callers always
// send a value for these (picked per-field), which replaces whatever the
// kept car already had.
export async function mergeCarRecords(
  keepCarId: string,
  mergeFromCarId: string,
  picked: PickedDetails
): Promise<ServiceResult> {
  if (!keepCarId || !mergeFromCarId || keepCarId === mergeFromCarId) {
    return { ok: false, error: "Pick a different car to merge." };
  }
  if (!picked.make || !picked.model || picked.year == null) {
    return { ok: false, error: "Make, model, and year are required." };
  }

  const db = getDb();
  // Files of photos dropped by the merge, deleted once it has committed.
  let orphanedPhotoFiles: string[] = [];

  try {
    withTransaction(db, () => {
      const mergeFrom = db.prepare("select url, ad_placed_at from cars where id = ?").get(mergeFromCarId) as
        | { url: string; ad_placed_at: string | null }
        | undefined;
      const keep = db.prepare("select id from cars where id = ?").get(keepCarId) as { id: string } | undefined;
      if (!mergeFrom || !keep) throw new Error("One of those cars no longer exists.");

      db.prepare(
        "insert into listing_history (id, car_id, previous_url, previous_ad_placed_at) values (?, ?, ?, ?)"
      ).run(randomUUID(), keepCarId, mergeFrom.url, mergeFrom.ad_placed_at);

      db.prepare("update listing_history set car_id = ? where car_id = ?").run(keepCarId, mergeFromCarId);

      const existingKeys = new Set(
        (
          db.prepare("select recorded_at, price from price_history where car_id = ?").all(keepCarId) as {
            recorded_at: string;
            price: number;
          }[]
        ).map((p) => `${p.recorded_at}|${p.price}`)
      );

      const mergeFromPrices = db
        .prepare("select id, recorded_at, price from price_history where car_id = ?")
        .all(mergeFromCarId) as { id: string; recorded_at: string; price: number }[];

      const deleteDuplicatePrice = db.prepare("delete from price_history where id = ?");
      const reassignPrice = db.prepare("update price_history set car_id = ? where id = ?");
      for (const p of mergeFromPrices) {
        if (existingKeys.has(`${p.recorded_at}|${p.price}`)) {
          deleteDuplicatePrice.run(p.id);
        } else {
          reassignPrice.run(keepCarId, p.id);
        }
      }

      db.prepare(
        `update cars set make = ?, model = ?, year = ?, cylinders = ?, spec = ?, exterior_color = ?, interior_color = ?
         where id = ?`
      ).run(
        picked.make,
        picked.model,
        picked.year,
        picked.cylinders,
        picked.spec,
        picked.exterior_color,
        picked.interior_color,
        keepCarId
      );

      // If mergeFromCarId is/was part of an "also listed at" group (either
      // as the anchor other cars' group_id points at, or as a plain
      // member), fold that relationship onto the surviving car first —
      // otherwise the delete below fails outright (group_id's FK rejects
      // deleting a car other rows still reference), and even if it didn't,
      // silently dropping the "also listed at" link would be a real loss.
      linkCarIds(db, keepCarId, mergeFromCarId);

      // Photos: the kept car's own win; if it has none, it takes the merged
      // car's. Whatever's left on the merged car goes with it (cascade).
      if (getPhotoFiles(keepCarId).length === 0) {
        db.prepare("update car_photos set car_id = ? where car_id = ?").run(keepCarId, mergeFromCarId);
      } else {
        orphanedPhotoFiles = getPhotoFiles(mergeFromCarId);
      }

      db.prepare("delete from cars where id = ?").run(mergeFromCarId);
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not merge these cars." };
  }
  await deletePhotoFiles(orphanedPhotoFiles);
  return { ok: true };
}

// "Also listed at" — the same physical car posted on more than one site at
// once. Unlike a merge, this never touches either car's own data (price
// history, url, removed/favorite status all stay exactly as they were) —
// it's purely the group_id relationship, so it's trivially reversible via
// unlinkCarRecord below.
export function linkCarRecords(carAId: string, carBId: string): ServiceResult {
  if (!carAId || !carBId || carAId === carBId) {
    return { ok: false, error: "Pick a different car to link." };
  }

  const db = getDb();
  try {
    withTransaction(db, () => linkCarIds(db, carAId, carBId));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not link these cars." };
  }
  return { ok: true };
}

// Removes one car from its "also listed at" group, leaving the rest of the
// group intact. Handles every case symmetrically: leaving as a plain
// member (the common case — the remaining members already point at the
// same anchor, nothing else to do), leaving as the anchor with 2+ other
// members remaining (re-anchors the group onto one of them), and leaving a
// group down to 0-1 members (the group dissolves entirely).
export function unlinkCarRecord(carId: string): ServiceResult {
  if (!carId) return { ok: false, error: "Missing car." };

  const db = getDb();
  try {
    withTransaction(db, () => {
      const car = db.prepare("select id, group_id from cars where id = ?").get(carId) as
        | { id: string; group_id: string | null }
        | undefined;
      if (!car) throw new Error("That car no longer exists.");

      const anchorId = car.group_id ?? car.id;
      const remaining = db
        .prepare("select id from cars where (id = ? or group_id = ?) and id != ?")
        .all(anchorId, anchorId, carId) as { id: string }[];

      db.prepare("update cars set group_id = null where id = ?").run(carId);

      if (remaining.length === 1) {
        // Down to a single car — no group left to belong to.
        db.prepare("update cars set group_id = null where id = ?").run(remaining[0].id);
      } else if (remaining.length >= 2 && carId === anchorId) {
        // The anchor itself is leaving but 2+ others remain — re-anchor
        // the group onto the first of them instead of leaving it orphaned.
        const newAnchor = remaining[0].id;
        db.prepare("update cars set group_id = null where id = ?").run(newAnchor);
        for (const m of remaining.slice(1)) {
          db.prepare("update cars set group_id = ? where id = ?").run(newAnchor, m.id);
        }
      }
      // Otherwise (a non-anchor member leaving, 2+ others remain): the
      // anchor is unchanged and every remaining member already points at
      // it correctly — nothing further to do.
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not unlink that car." };
  }
  return { ok: true };
}

// Returns whether the car exists.
export function markCarOpenedRecord(carId: string): boolean {
  const result = getDb()
    .prepare("update cars set last_opened_at = ? where id = ?")
    .run(new Date().toISOString(), carId);
  return result.changes > 0;
}

export type ListingDetailsResult =
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      details: ListingDetails;
      sources: Partial<Record<keyof ListingDetails, string>>;
      // Only when it's AED — the add form records every price in AED.
      price: number | null;
      // Photo URLs to download once the car is saved — empty unless the
      // "Save listing photos" setting is on.
      images: string[];
    };

// Pre-fills the add-car form: reads whatever the listing page exposes about
// the car (site-agnostic — schema.org data, spec tables, page text). Nothing
// is saved here; the form just fills its empty fields for review.
export async function fetchListingDetails(url: string): Promise<ListingDetailsResult> {
  if (!/^https?:\/\//i.test(url)) return { kind: "error", message: "Not a web URL." };
  const result = await callScraper("/extract", url);
  if (!result.ok) return { kind: "error", message: result.message };
  const { data } = result;
  if (isGone(data)) return { kind: "error", message: "The listing seems to be gone — it may have been removed." };
  const isAed = !data.currency || data.currency === "AED";
  return {
    kind: "ok",
    details: data.details ?? {},
    sources: data.detail_sources ?? {},
    price: data.price != null && isAed && data.source !== "text" ? Math.round(data.price) : null,
    images: getPhotoSettings().enabled ? (data.images ?? []) : [],
  };
}

export type ListingCheckResult = (
  | { kind: "error"; message: string }
  | { kind: "gone"; status: number }
  | { kind: "no-price"; title: string | null }
  | { kind: "unchanged"; price: number; currency: string }
  | { kind: "updated"; price: number; previous: number | null; currency: string }
  // Found something, but not trusted enough to save on its own — a regex
  // hit over page text, or a currency that doesn't match what's tracked.
  // The client offers a one-click save instead.
  | { kind: "unconfirmed"; price: number; currency: string; reason: string }
) & {
  // Listing photos downloaded by this check — only the first check after
  // "Save listing photos" is turned on finds a car with none.
  photosSaved?: number;
};

// Asks the Scrapling sidecar (scraper/server.py) to fetch the car's listing
// and logs a new price point if it changed — the same decision a scan makes
// per car (lib/scan.ts), for one car on demand.
export async function checkListing(carId: string): Promise<ListingCheckResult> {
  const db = getDb();
  const car = db.prepare("select url from cars where id = ?").get(carId) as { url: string } | undefined;
  if (!car) return { kind: "error", message: "That car no longer exists." };

  const result = await callScraper("/scrape", car.url);
  if (!result.ok) return { kind: "error", message: result.message };
  const { data } = result;

  if (isGone(data)) return { kind: "gone", status: data.status ?? 0 };
  if (data.price == null) return { kind: "no-price", title: data.title };

  // Same bar as for saving a price: only a page whose structured data names
  // a price is trusted to be the listing itself, so its photos are this car's.
  const photosSaved = data.source === "text" ? 0 : await grabPhotosIfMissing(carId, data.images, car.url);

  const latest = db
    .prepare(
      "select price, currency from price_history where car_id = ? order by recorded_at desc, created_at desc limit 1"
    )
    .get(carId) as { price: number; currency: string } | undefined;
  const trackedCurrency = latest?.currency ?? "AED";
  const currency = normalizeCurrency(data.currency, trackedCurrency);
  const price = Math.round(data.price);

  if (currency !== trackedCurrency) {
    return {
      kind: "unconfirmed",
      price,
      currency,
      reason: `Listing shows ${currency}, tracked in ${trackedCurrency}.`,
      photosSaved,
    };
  }
  if (latest && latest.price === price) return { kind: "unchanged", price, currency, photosSaved };
  if (data.source === "text") {
    return { kind: "unconfirmed", price, currency, reason: "Guessed from page text, not the site's price data." };
  }

  insertPricePoint(db, carId, price, null);
  return { kind: "updated", price, previous: latest?.price ?? null, currency, photosSaved };
}

export async function buildExport() {
  const cars = await getCarsWithPrices();
  return {
    exported_at: new Date().toISOString(),
    cars: cars.map((c) => ({
      url: c.url,
      make: c.make,
      model: c.model,
      year: c.year,
      km: c.km,
      cylinders: c.cylinders,
      spec: c.spec,
      exterior_color: c.exterior_color,
      interior_color: c.interior_color,
      ad_placed_at: c.ad_placed_at,
      created_at: c.created_at,
      is_favorite: c.is_favorite,
      is_removed: c.is_removed,
      is_struck_out: c.is_struck_out,
      strike_out_reason: c.strike_out_reason,
      price_history: c.price_history.map((p) => ({
        price: p.price,
        currency: p.currency,
        recorded_at: p.recorded_at,
      })),
      listing_history: c.listing_history.map((h) => ({
        previous_url: h.previous_url,
        previous_ad_placed_at: h.previous_ad_placed_at,
        replaced_at: h.replaced_at,
      })),
    })),
  };
}

export function exportFilename() {
  return `carpulse-export-${new Date().toISOString().slice(0, 10)}.json`;
}

const importPriceSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().min(1).default("AED"),
  recorded_at: z.string().min(1),
});

const importListingHistorySchema = z.object({
  previous_url: z.string().url(),
  previous_ad_placed_at: z.string().nullable().optional(),
  replaced_at: z.string().min(1),
});

const importCarSchema = z.object({
  url: z.string().url(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number(),
  km: z.number().nullable().optional(),
  cylinders: z.number().nullable().optional(),
  spec: z.string().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  interior_color: z.string().nullable().optional(),
  ad_placed_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  is_favorite: z.boolean().optional(),
  is_removed: z.boolean().optional(),
  is_struck_out: z.boolean().optional(),
  strike_out_reason: z.string().nullable().optional(),
  price_history: z.array(importPriceSchema).default([]),
  listing_history: z.array(importListingHistorySchema).default([]),
});

const importFileSchema = z.object({
  cars: z.array(importCarSchema),
});

// Import only ever adds: existing cars (matched by url) and existing price
// points (matched by car + recorded_at + price) are left untouched, never
// overwritten. This is a merge, not a restore.
export function importCars(json: unknown): ServiceResult<{ summary: string }> {
  const parsed = importFileSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "That file isn't valid CarPulse export JSON." };

  const db = getDb();

  let carsAdded = 0;
  let carsMatched = 0;
  let pricesAdded = 0;
  let pricesSkipped = 0;

  const findByUrl = db.prepare("select id from cars where url = ?");
  // created_at: coalesce falls back to the table's default (now) when the
  // import entry doesn't specify one, same as omitting the column would.
  const insertCar = db.prepare(
    `insert into cars (id, url, make, model, year, km, cylinders, spec, exterior_color, interior_color,
     ad_placed_at, is_favorite, is_removed, is_struck_out, strike_out_reason, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`
  );
  const existingPricesStmt = db.prepare("select price, recorded_at from price_history where car_id = ?");
  const insertPrice = db.prepare(
    "insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, ?)"
  );
  const existingListingsStmt = db.prepare("select previous_url from listing_history where car_id = ?");
  const insertListing = db.prepare(
    "insert into listing_history (id, car_id, previous_url, previous_ad_placed_at, replaced_at) values (?, ?, ?, ?, ?)"
  );

  withTransaction(db, () => {
    for (const entry of parsed.data.cars) {
      const existing = findByUrl.get(entry.url) as { id: string } | undefined;
      let carId = existing?.id;

      if (carId) {
        carsMatched++;
      } else {
        carId = randomUUID();
        insertCar.run(
          carId,
          entry.url,
          entry.make,
          entry.model,
          entry.year,
          entry.km ?? null,
          entry.cylinders ?? null,
          entry.spec ?? null,
          entry.exterior_color ?? null,
          entry.interior_color ?? null,
          entry.ad_placed_at ?? null,
          entry.is_favorite ? 1 : 0,
          entry.is_removed ? 1 : 0,
          entry.is_struck_out ? 1 : 0,
          entry.is_struck_out ? (entry.strike_out_reason ?? null) : null,
          entry.created_at ?? null
        );
        carsAdded++;
      }

      if (entry.price_history.length === 0) continue;

      const existingPrices = existingPricesStmt.all(carId) as { price: number; recorded_at: string }[];
      const existingKeys = new Set(existingPrices.map((p) => `${p.recorded_at}|${p.price}`));

      const newEntries = entry.price_history.filter((p) => !existingKeys.has(`${p.recorded_at}|${p.price}`));
      pricesSkipped += entry.price_history.length - newEntries.length;

      for (const p of newEntries) {
        insertPrice.run(randomUUID(), carId, p.price, p.currency, p.recorded_at);
        pricesAdded++;
      }

      if (entry.listing_history.length === 0) continue;

      const existingUrls = new Set(
        (existingListingsStmt.all(carId) as { previous_url: string }[]).map((l) => l.previous_url)
      );

      for (const h of entry.listing_history) {
        if (existingUrls.has(h.previous_url)) continue;
        insertListing.run(randomUUID(), carId, h.previous_url, h.previous_ad_placed_at ?? null, h.replaced_at);
      }
    }
  });

  return {
    ok: true,
    summary: `Added ${carsAdded} new car(s) and ${pricesAdded} new price point(s). Matched ${carsMatched} existing car(s) by URL and skipped ${pricesSkipped} duplicate price point(s).`,
  };
}
