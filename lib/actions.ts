"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import {
  checkListing,
  createCarRecord,
  fetchListingDetails,
  findPossibleDuplicate,
  importCars,
  insertPricePoint,
  linkCarRecords,
  markCarOpenedRecord,
  mergeCarRecords,
  relistCarRecord,
  unlinkCarRecord,
  type CarFields,
  type ListingCheckResult,
  type ListingDetailsResult,
} from "@/lib/car-service";
import { carLabel, undoLastChange, withUndo } from "@/lib/undo";

// Thin FormData wrappers over lib/car-service.ts, which holds the actual
// logic so the REST API (app/api/**, used by the native app) shares it.
export type { ListingCheckResult, ListingDetailsResult };

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}

function parseText(value: FormDataEntryValue | null): string | null {
  return String(value ?? "").trim() || null;
}

// Every car field the add/edit/relist forms submit. Null url/make/model/year
// means missing — callers check their own required set before using it.
function parseCarFields(formData: FormData): Omit<CarFields, "url" | "make" | "model" | "year"> & {
  url: string;
  make: string;
  model: string;
  year: number | null;
} {
  return {
    url: String(formData.get("url") ?? "").trim(),
    make: String(formData.get("make") ?? "").trim(),
    model: String(formData.get("model") ?? "").trim(),
    year: parseNumber(formData.get("year")),
    km: parseNumber(formData.get("km")),
    cylinders: parseNumber(formData.get("cylinders")),
    spec: parseText(formData.get("spec")),
    exterior_color: parseText(formData.get("exterior_color")),
    interior_color: parseText(formData.get("interior_color")),
    ad_placed_at: parseDate(formData.get("ad_placed_at")),
  };
}

// Checked as a plain function call from the client, before the form is ever
// submitted — not wired through useActionState's <form action> lifecycle,
// which resets uncontrolled inputs after any non-redirecting round trip and
// would wipe what the user typed before they got to confirm.
export async function checkCarDuplicate(formData: FormData) {
  const fields = parseCarFields(formData);
  return findPossibleDuplicate({
    make: fields.make,
    model: fields.model,
    exteriorColor: fields.exterior_color,
    interiorColor: fields.interior_color,
    km: fields.km,
  });
}

function parsePhotoUrls(value: FormDataEntryValue | null): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string").slice(0, 40) : [];
  } catch {
    return [];
  }
}

export async function createCar(_prevState: unknown, formData: FormData) {
  const fields = parseCarFields(formData);
  const price = parseNumber(formData.get("price"));

  if (!fields.url || !fields.make || !fields.model || fields.year == null || price == null) {
    return { error: "URL, make, model, year, and price are required." };
  }

  const result = await createCarRecord({
    fields: { ...fields, year: fields.year },
    price,
    recordedAt: parseDate(formData.get("recorded_at")),
    alsoListedAtCarId: parseText(formData.get("also_listed_at_car_id")),
    photoUrls: parsePhotoUrls(formData.get("photo_urls")),
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  redirect(`/?highlight=${result.id}`);
}

export async function relistCar(_prevState: unknown, formData: FormData) {
  const existingCarId = String(formData.get("existing_car_id") ?? "");
  const fields = parseCarFields(formData);
  const price = parseNumber(formData.get("price"));

  if (!existingCarId || !fields.url || !fields.make || !fields.model || fields.year == null || price == null) {
    return { error: "URL, make, model, year, and price are required." };
  }

  const result = await relistCarRecord({
    existingCarId,
    fields: { ...fields, year: fields.year },
    price,
    recordedAt: parseDate(formData.get("recorded_at")),
    photoUrls: parsePhotoUrls(formData.get("photo_urls")),
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  redirect(`/?highlight=${existingCarId}`);
}

export async function mergeCars(formData: FormData) {
  const fields = parseCarFields(formData);
  const year = fields.year;
  if (!fields.make || !fields.model || year == null) {
    return { error: "Make, model, and year are required." };
  }

  const result = await mergeCarRecords(
    String(formData.get("keep_car_id") ?? ""),
    String(formData.get("merge_from_car_id") ?? ""),
    { ...fields, year }
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return { success: true as const };
}

export async function linkCars(formData: FormData) {
  const result = linkCarRecords(String(formData.get("car_a_id") ?? ""), String(formData.get("car_b_id") ?? ""));
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return { success: true as const };
}

export async function unlinkCar(formData: FormData) {
  const result = unlinkCarRecord(String(formData.get("car_id") ?? ""));
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return { success: true as const };
}

export async function updateCar(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const f = parseCarFields(formData);

  if (!carId || !f.url || !f.make || !f.model || f.year == null) {
    return { error: "URL, make, model, and year are required." };
  }

  const db = getDb();

  try {
    withUndo(db, `Edited ${carLabel(db, carId)}`, [carId], () =>
      db
        .prepare(
          `update cars set url = ?, make = ?, model = ?, year = ?, km = ?, cylinders = ?, spec = ?,
           exterior_color = ?, interior_color = ?, ad_placed_at = ? where id = ?`
        )
        .run(f.url, f.make, f.model, f.year, f.km, f.cylinders, f.spec, f.exterior_color, f.interior_color, f.ad_placed_at, carId)
    );
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message.includes("UNIQUE constraint failed")
          ? "Another tracked car already has that URL."
          : err instanceof Error
            ? err.message
            : "Could not save changes.",
    };
  }

  revalidatePath("/");
  return { success: true as const };
}

// Separate from is_removed: is_removed means the ad came down on the listing site;
// this is for any other reason to set a car aside (wrong spec entered,
// duplicate, etc.), with an optional free-text note. Used from a plain
// <form action> embedded directly in the dashboard's expanded card — no
// redirect, so the mutation just revalidates "/" and the form's normal
// post-submit refresh picks up the change in place.
export async function setCarStruckOut(formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const struckOut = formData.get("struck_out") === "true";
  const reason = parseText(formData.get("reason"));

  if (!carId) return;

  const db = getDb();
  withUndo(db, `${struckOut ? "Struck out" : "Restored"} ${carLabel(db, carId)}`, [carId], () =>
    db
      .prepare("update cars set is_struck_out = ?, strike_out_reason = ? where id = ?")
      .run(struckOut ? 1 : 0, struckOut ? reason : null, carId)
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
  markCarOpenedRecord(carId);
  revalidatePath("/");
}

// Plain args, no redirect — toggles is_removed from the dashboard card
// without leaving it.
export async function setCarRemovedFlag(carId: string, removed: boolean) {
  if (!carId) return;
  const db = getDb();
  withUndo(db, `Marked ${carLabel(db, carId)} ${removed ? "removed" : "active"}`, [carId], () =>
    db.prepare("update cars set is_removed = ? where id = ?").run(removed ? 1 : 0, carId)
  );
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
    withUndo(db, `Added a price to ${carLabel(db, carId)}`, [carId], () =>
      insertPricePoint(db, carId, price, recordedAt)
    );
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
    withUndo(db, `Added a price to ${carLabel(db, carId)}`, [carId], () =>
      insertPricePoint(db, carId, price, recordedAt)
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the price." };
  }

  revalidatePath("/");
  return { success: true as const };
}

export async function readListingDetails(url: string): Promise<ListingDetailsResult> {
  return fetchListingDetails(url);
}

export async function checkListingForUpdates(carId: string): Promise<ListingCheckResult> {
  const result = await checkListing(carId);
  // A logged price or newly saved photos both change what the dashboard shows.
  if (result.kind === "updated" || (result.photosSaved ?? 0) > 0) revalidatePath("/");
  return result;
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

  withUndo(db, `Deleted a price from ${carLabel(db, carId)}`, [carId], () =>
    db.prepare("delete from price_history where id = ?").run(priceId)
  );

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
    withUndo(db, `Restored a deleted price on ${carLabel(db, carId)}`, [carId], () =>
      insertPricePoint(db, carId, price, recordedAt, currency)
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not restore that price." };
  }

  revalidatePath("/");
  return { success: true as const };
}

// "Undo" on the dashboard — expectedId is the change the button showed.
export async function undoLastChangeAction(expectedId: string) {
  const result = await undoLastChange(expectedId);
  if (result.ok) revalidatePath("/");
  return result;
}

export async function importData(_prevState: unknown, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a JSON file to import." };
  }

  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { error: "That file isn't valid CarPulse export JSON." };
  }

  const result = importCars(json);
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return { success: true as const, summary: result.summary };
}
