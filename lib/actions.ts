"use server";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, withTransaction } from "@/lib/db/client";

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed");
}

// recordedAt null falls back to the column's own default (today) rather
// than needing two separate prepared statements per call site.
function insertPricePoint(db: DatabaseSync, carId: string, price: number, recordedAt: string | null) {
  db.prepare(
    "insert into price_history (id, car_id, price, recorded_at) values (?, ?, ?, coalesce(?, date('now')))"
  ).run(randomUUID(), carId, price, recordedAt);
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
  exterior_color: string | null;
  interior_color: string | null;
};

function findPossibleDuplicate(entry: {
  make: string;
  model: string;
  exteriorColor: string | null;
  interiorColor: string | null;
  km: number | null;
}) {
  if (entry.km == null) return null;

  const db = getDb();
  const candidates = db
    .prepare(
      "select id, url, make, model, year, km, exterior_color, interior_color from cars where make = ? collate nocase and model = ? collate nocase"
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
      return { id: c.id, url: c.url, make: c.make, model: c.model, year: c.year, km: c.km };
    }
  }

  return null;
}

// Checked as a plain function call from the client, before the form is ever
// submitted — not wired through useActionState's <form action> lifecycle,
// which resets uncontrolled inputs after any non-redirecting round trip and
// would wipe what the user typed before they got to confirm.
export async function checkCarDuplicate(formData: FormData) {
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const km = parseNumber(formData.get("km"));
  const exteriorColor = String(formData.get("exterior_color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interior_color") ?? "").trim() || null;

  if (!make || !model) return null;

  return findPossibleDuplicate({ make, model, exteriorColor, interiorColor, km });
}

export async function createCar(_prevState: unknown, formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = parseNumber(formData.get("year"));
  const km = parseNumber(formData.get("km"));
  const cylinders = parseNumber(formData.get("cylinders"));
  const spec = String(formData.get("spec") ?? "").trim() || null;
  const exteriorColor = String(formData.get("exterior_color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interior_color") ?? "").trim() || null;
  const adPlacedAt = parseDate(formData.get("ad_placed_at"));
  const price = parseNumber(formData.get("price"));
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!url || !make || !model || year == null || price == null) {
    return { error: "URL, make, model, year, and price are required." };
  }

  const db = getDb();
  const carId = randomUUID();

  try {
    withTransaction(db, () => {
      db.prepare(
        `insert into cars (id, url, make, model, year, km, cylinders, spec, exterior_color, interior_color, ad_placed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(carId, url, make, model, year, km, cylinders, spec, exteriorColor, interiorColor, adPlacedAt);

      insertPricePoint(db, carId, price, recordedAt);
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the car." };
  }

  revalidatePath("/");
  redirect(`/?highlight=${carId}`);
}

export async function updateCar(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = parseNumber(formData.get("year"));
  const km = parseNumber(formData.get("km"));
  const cylinders = parseNumber(formData.get("cylinders"));
  const spec = String(formData.get("spec") ?? "").trim() || null;
  const exteriorColor = String(formData.get("exterior_color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interior_color") ?? "").trim() || null;
  const adPlacedAt = parseDate(formData.get("ad_placed_at"));

  if (!carId || !url || !make || !model || year == null) {
    return { error: "URL, make, model, and year are required." };
  }

  const db = getDb();

  try {
    db.prepare(
      `update cars set url = ?, make = ?, model = ?, year = ?, km = ?, cylinders = ?, spec = ?,
       exterior_color = ?, interior_color = ?, ad_placed_at = ? where id = ?`
    ).run(url, make, model, year, km, cylinders, spec, exteriorColor, interiorColor, adPlacedAt, carId);
  } catch (err) {
    return {
      error: isUniqueViolation(err)
        ? "Another tracked car already has that URL."
        : err instanceof Error
          ? err.message
          : "Could not save changes.",
    };
  }

  revalidatePath("/");
  return { success: true as const };
}

// Separate from is_removed: is_removed means the ad came down on Dubizzle;
// this is for any other reason to set a car aside (wrong spec entered,
// duplicate, etc.), with an optional free-text note. Used from a plain
// <form action> embedded directly in the dashboard's expanded card — no
// redirect, so the mutation just revalidates "/" and the form's normal
// post-submit refresh picks up the change in place.
export async function setCarStruckOut(formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const struckOut = formData.get("struck_out") === "true";
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!carId) return;

  const db = getDb();
  db.prepare("update cars set is_struck_out = ?, strike_out_reason = ? where id = ?").run(
    struckOut ? 1 : 0,
    struckOut ? reason : null,
    carId
  );

  revalidatePath("/");
}

// Called directly (not a form action) from OpenListingRedirect, running in
// the *new* tab, right before it forwards to the real listing. Tracked in
// the DB rather than client-side storage (cookie/localStorage) — at least
// one mobile browser wasn't sharing either reliably across its own tabs,
// while a plain server round-trip has no such ambiguity.
export async function markCarOpened(carId: string) {
  if (!carId) return;
  const db = getDb();
  db.prepare("update cars set last_opened_at = ? where id = ?").run(new Date().toISOString(), carId);
  revalidatePath("/");
}

// Plain args, no redirect — toggles is_removed from the dashboard card
// without leaving it.
export async function setCarRemovedFlag(carId: string, removed: boolean) {
  if (!carId) return;
  const db = getDb();
  db.prepare("update cars set is_removed = ? where id = ?").run(removed ? 1 : 0, carId);
  revalidatePath("/");
}

// Plain args, not FormData, and no redirect — called directly from a client
// component (the dashboard's star toggle), which sidesteps the
// form-reset-on-non-redirect issue that plain <form action> bindings hit
// elsewhere in this app.
export async function setCarFavorite(carId: string, favorite: boolean) {
  if (!carId) return;
  const db = getDb();
  db.prepare("update cars set is_favorite = ? where id = ?").run(favorite ? 1 : 0, carId);
  revalidatePath("/");
}

export async function addPrice(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const price = parseNumber(formData.get("price"));
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!carId || price == null) {
    return { error: "Price is required." };
  }

  const db = getDb();
  try {
    insertPricePoint(db, carId, price, recordedAt);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the price." };
  }

  revalidatePath("/");
  redirect(`/?highlight=${carId}`);
}

// Same as addPrice but for the dashboard card view, which adds a price
// without navigating away — a redirect would defeat the point of doing this
// inline.
export async function addPriceInline(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const price = parseNumber(formData.get("price"));
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!carId || price == null) {
    return { error: "Price is required." };
  }

  const db = getDb();
  try {
    insertPricePoint(db, carId, price, recordedAt);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the price." };
  }

  revalidatePath("/");
  return { success: true as const };
}

// Called directly from a client component (not bound to a <form action>),
// so it can return the deleted row's data for an "Undo" affordance and
// doesn't redirect — the list re-renders from revalidated data instead.
export async function deletePrice(formData: FormData) {
  const priceId = String(formData.get("price_id") ?? "");
  const carId = String(formData.get("car_id") ?? "");

  if (!priceId || !carId) {
    return { error: "Missing price entry." };
  }

  const db = getDb();
  const row = db
    .prepare("select price, currency, recorded_at from price_history where id = ?")
    .get(priceId) as { price: number; currency: string; recorded_at: string } | undefined;

  if (!row) {
    return { error: "Could not delete that price." };
  }

  // Server Action return values cross the same Server->Client serialization
  // boundary page props do — node:sqlite's null-prototype rows fail that
  // ("Only plain objects... Classes or null prototypes are not supported"),
  // so this has to be re-spread into an actual plain object.
  const deleted = { ...row };

  db.prepare("delete from price_history where id = ?").run(priceId);

  revalidatePath("/");
  return { success: true as const, deleted };
}

// Re-inserts a price row deleted via deletePrice. This is a plain insert,
// not a real "undo" of the specific row (a new id/created_at), which is
// fine here: nothing else keys off a price_history row's identity.
export async function undoDeletePrice(formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const price = parseNumber(formData.get("price"));
  const currency = String(formData.get("currency") ?? "AED");
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!carId || price == null || !recordedAt) {
    return { error: "Nothing to restore." };
  }

  const db = getDb();
  try {
    db.prepare("insert into price_history (id, car_id, price, currency, recorded_at) values (?, ?, ?, ?, ?)").run(
      randomUUID(),
      carId,
      price,
      currency,
      recordedAt
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not restore that price." };
  }

  revalidatePath("/");
  return { success: true as const };
}

const importPriceSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().min(1).default("AED"),
  recorded_at: z.string().min(1),
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
});

const importFileSchema = z.object({
  cars: z.array(importCarSchema),
});

// Import only ever adds: existing cars (matched by url) and existing price
// points (matched by car + recorded_at + price) are left untouched, never
// overwritten. This is a merge, not a restore.
export async function importData(_prevState: unknown, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a JSON file to import." };
  }

  let parsed;
  try {
    const text = await file.text();
    parsed = importFileSchema.parse(JSON.parse(text));
  } catch {
    return { error: "That file isn't valid CarPulse export JSON." };
  }

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

  withTransaction(db, () => {
    for (const entry of parsed.cars) {
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
    }
  });

  revalidatePath("/");

  return {
    success: true as const,
    summary: `Added ${carsAdded} new car(s) and ${pricesAdded} new price point(s). Matched ${carsMatched} existing car(s) by URL and skipped ${pricesSkipped} duplicate price point(s).`,
  };
}
