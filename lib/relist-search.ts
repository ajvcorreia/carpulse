import type { Car } from "@/lib/types";

// Removed ads often come back as a new listing for the same car. This builds
// a search on the car's original site for others like it — same make, model
// and year, similar mileage — so the user can spot the relisting by eye.

// A mileage band around the car's: a relisted car has usually been driven a
// bit since, rarely less. Null when the mileage isn't known.
function kmRange(km: number | null): [number, number] | null {
  if (!km) return null;
  const round = (n: number) => Math.round(n / 1000) * 1000;
  return [Math.max(0, round(km * 0.85 - 2000)), round(km * 1.15 + 5000)];
}

function slug(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// dubizzle's model slug, from how the model is written in CarPulse — needed
// for short links (dubizzle.com/s/…), which don't carry it. Its own URLs
// group BMW and Mercedes models into series and classes ("330i" → 3-series,
// "E200" → e-class); everything else goes by its first word ("A5 40 TFSI" →
// a5, "Civic Sport" → civic).
function dubizzleModel(make: string, model: string) {
  const m = model.trim();
  if (/^bmw$/i.test(make)) {
    const series = m.match(/^M?(\d)\d{2}/i);
    if (series) return `${series[1]}-series`;
  }
  if (/^mercedes/i.test(make)) {
    const cls = m.match(/^([A-Z]{1,3})\s?\d{2,3}\b/i);
    if (cls) return `${cls[1].toLowerCase()}-class`;
  }
  return slug(m.split(/\s+/)[0]);
}

function dubizzleUrl(car: Car) {
  // A full listing URL already holds dubizzle's own make/model slugs.
  const own = car.url.match(/\/motors\/used-cars\/([^/]+)\/([^/]+)\//);
  const [make, model] = own ? [own[1], own[2]] : [slug(car.make), dubizzleModel(car.make, car.model)];
  const params = new URLSearchParams({ year__gte: String(car.year), year__lte: String(car.year) });
  const range = kmRange(car.km);
  if (range) {
    params.set("kilometers__gte", String(range[0]));
    params.set("kilometers__lte", String(range[1]));
  }
  // uae., not the listing's emirate — a relisting can move to another one.
  return `https://uae.dubizzle.com/motors/used-cars/${make}/${model}/?${params}`;
}

// dubicars' model pages are few enough cars to scan by eye, and the model
// slug drops BMW's trailing "i" ("540i" → 540) — where it sends a removed ad.
function dubicarsUrl(car: Car) {
  const model = slug(car.model.split(/\s+/)[0]).replace(/^(\d{3})[a-z]$/, "$1");
  return `https://www.dubicars.com/uae/used/${slug(car.make)}/${model}`;
}

// Anywhere else: a web search confined to the site.
function siteSearchUrl(car: Car, host: string) {
  const q = `${host ? `site:${host} ` : ""}${car.year} ${car.make} ${car.model}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function relistSearchUrl(car: Car): string {
  let host = "";
  try {
    host = new URL(car.url).hostname.replace(/^www\./, "");
  } catch {
    // Not a URL — fall through to a plain web search.
  }
  if (host === "dubizzle.com" || host.endsWith(".dubizzle.com")) return dubizzleUrl(car);
  if (host === "dubicars.com") return dubicarsUrl(car);
  return siteSearchUrl(car, host);
}
