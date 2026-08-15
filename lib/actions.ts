"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
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

async function findPossibleDuplicate(
  supabase: ReturnType<typeof createClient>,
  entry: { make: string; model: string; exteriorColor: string | null; interiorColor: string | null; km: number | null }
) {
  const { data: candidates } = await supabase
    .from("cars")
    .select("id, url, make, model, year, km, exterior_color, interior_color")
    .ilike("make", entry.make)
    .ilike("model", entry.model);

  if (!candidates || entry.km == null) return null;

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

  const supabase = createClient();
  return findPossibleDuplicate(supabase, { make, model, exteriorColor, interiorColor, km });
}

export async function createCar(_prevState: unknown, formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = parseNumber(formData.get("year"));
  const km = parseNumber(formData.get("km"));
  const spec = String(formData.get("spec") ?? "").trim() || null;
  const exteriorColor = String(formData.get("exterior_color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interior_color") ?? "").trim() || null;
  const adPlacedAt = parseDate(formData.get("ad_placed_at"));
  const price = parseNumber(formData.get("price"));
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!url || !make || !model || year == null || price == null) {
    return { error: "URL, make, model, year, and price are required." };
  }

  const supabase = createClient();

  const { data: car, error: carError } = await supabase
    .from("cars")
    .insert({
      url,
      make,
      model,
      year,
      km,
      spec,
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      ad_placed_at: adPlacedAt,
    })
    .select("id")
    .single();

  if (carError || !car) {
    return { error: carError?.message ?? "Could not save the car." };
  }

  const { error: priceError } = await supabase
    .from("price_history")
    .insert({ car_id: car.id, price, ...(recordedAt ? { recorded_at: recordedAt } : {}) });

  if (priceError) {
    return { error: priceError.message };
  }

  revalidatePath("/");
  redirect(`/car/${car.id}`);
}

export async function updateCar(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const year = parseNumber(formData.get("year"));
  const km = parseNumber(formData.get("km"));
  const spec = String(formData.get("spec") ?? "").trim() || null;
  const exteriorColor = String(formData.get("exterior_color") ?? "").trim() || null;
  const interiorColor = String(formData.get("interior_color") ?? "").trim() || null;
  const adPlacedAt = parseDate(formData.get("ad_placed_at"));

  if (!carId || !url || !make || !model || year == null) {
    return { error: "URL, make, model, and year are required." };
  }

  const supabase = createClient();

  const { error } = await supabase
    .from("cars")
    .update({
      url,
      make,
      model,
      year,
      km,
      spec,
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      ad_placed_at: adPlacedAt,
    })
    .eq("id", carId);

  if (error) {
    return {
      error: error.code === "23505" ? "Another tracked car already has that URL." : error.message,
    };
  }

  revalidatePath("/");
  revalidatePath(`/car/${carId}`);
  redirect(`/car/${carId}`);
}

export async function setCarRemoved(formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const removed = formData.get("removed") === "true";

  if (!carId) return;

  const supabase = createClient();
  await supabase.from("cars").update({ is_removed: removed }).eq("id", carId);

  revalidatePath("/");
  revalidatePath(`/car/${carId}`);
  redirect(`/car/${carId}`);
}

export async function addPrice(_prevState: unknown, formData: FormData) {
  const carId = String(formData.get("car_id") ?? "");
  const price = parseNumber(formData.get("price"));
  const recordedAt = parseDate(formData.get("recorded_at"));

  if (!carId || price == null) {
    return { error: "Price is required." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("price_history")
    .insert({ car_id: carId, price, ...(recordedAt ? { recorded_at: recordedAt } : {}) });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  revalidatePath(`/car/${carId}`);
  redirect(`/car/${carId}`);
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
  spec: z.string().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  interior_color: z.string().nullable().optional(),
  ad_placed_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
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
    return { error: "That file isn't valid DubbizleWatch export JSON." };
  }

  const supabase = createClient();

  let carsAdded = 0;
  let carsMatched = 0;
  let pricesAdded = 0;
  let pricesSkipped = 0;

  for (const entry of parsed.cars) {
    const { data: existingCar } = await supabase.from("cars").select("id").eq("url", entry.url).maybeSingle();

    let carId = existingCar?.id as string | undefined;

    if (carId) {
      carsMatched++;
    } else {
      const { data: newCar, error: carError } = await supabase
        .from("cars")
        .insert({
          url: entry.url,
          make: entry.make,
          model: entry.model,
          year: entry.year,
          km: entry.km ?? null,
          spec: entry.spec ?? null,
          exterior_color: entry.exterior_color ?? null,
          interior_color: entry.interior_color ?? null,
          ad_placed_at: entry.ad_placed_at ?? null,
          ...(entry.created_at ? { created_at: entry.created_at } : {}),
        })
        .select("id")
        .single();

      if (carError || !newCar) continue;
      carId = newCar.id;
      carsAdded++;
    }

    if (entry.price_history.length === 0) continue;

    const { data: existingPrices } = await supabase
      .from("price_history")
      .select("price, recorded_at")
      .eq("car_id", carId);

    const existingKeys = new Set((existingPrices ?? []).map((p) => `${p.recorded_at}|${p.price}`));

    const newEntries = entry.price_history.filter((p) => !existingKeys.has(`${p.recorded_at}|${p.price}`));
    pricesSkipped += entry.price_history.length - newEntries.length;

    if (newEntries.length === 0) continue;

    const { error: priceError } = await supabase.from("price_history").insert(
      newEntries.map((p) => ({
        car_id: carId,
        price: p.price,
        currency: p.currency,
        recorded_at: p.recorded_at,
      }))
    );

    if (!priceError) pricesAdded += newEntries.length;
  }

  revalidatePath("/");

  return {
    success: true as const,
    summary: `Added ${carsAdded} new car(s) and ${pricesAdded} new price point(s). Matched ${carsMatched} existing car(s) by URL and skipped ${pricesSkipped} duplicate price point(s).`,
  };
}
