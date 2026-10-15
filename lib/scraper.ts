// Client for the Scrapling sidecar (scraper/server.py). Plain module, not a
// "use server" file, so both server actions and the background scan
// (lib/scan.ts) can call it.

export type ListingDetails = Partial<{
  make: string;
  model: string;
  year: number;
  km: number;
  cylinders: number;
  spec: string;
  exterior_color: string;
  interior_color: string;
  ad_placed_at: string;
}>;

export type ScrapeResponse = {
  status: number | null;
  title: string | null;
  price: number | null;
  currency: string | null;
  source: "json-ld" | "meta" | "text" | null;
  blocked?: boolean;
  // No price, and the page says the ad is gone — for sites that don't 404.
  gone_hint?: boolean;
  // The listing's photo URLs, gallery order (scraper/details.py,
  // extract_images). Absent when blocked; empty on a search/index page.
  images?: string[];
  // Only on /extract — see scraper/details.py.
  details?: ListingDetails;
  detail_sources?: Partial<Record<keyof ListingDetails, string>>;
};

export async function callScraper(
  path: "/scrape" | "/extract",
  url: string
): Promise<{ ok: true; data: ScrapeResponse } | { ok: false; message: string; blocked?: boolean }> {
  const scraperUrl = process.env.SCRAPER_URL;
  if (!scraperUrl) return { ok: false, message: "SCRAPER_URL isn't set, so there's no scraper to ask." };
  try {
    const res = await fetch(`${scraperUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      // A headless browser waiting out bot checks is slow — leave headroom
      // over the scraper's own 60s page timeout.
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: body?.error ?? `Scraper responded ${res.status}.` };
    const data = body as ScrapeResponse;
    if (data.blocked) {
      return { ok: false, blocked: true, message: "The site's bot protection blocked the scraper — try again later." };
    }
    return { ok: true, data };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError" ? "Scraper timed out." : "Couldn't reach the scraper.";
    return { ok: false, message };
  }
}

// The listing is gone: a real 404/410, or a page saying so with no price.
export function isGone(data: ScrapeResponse) {
  return data.status === 404 || data.status === 410 || data.gone_hint === true;
}

// Anything that isn't an ISO code (a site writing "Dirhams", say) can't be
// formatted or compared, so it's assumed to be the tracked one.
export function normalizeCurrency(currency: string | null, fallback: string) {
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}
