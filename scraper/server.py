"""CarPulse listing scraper — a tiny HTTP wrapper around Scrapling.

POST /scrape {"url": "..."} fetches the listing with Scrapling's
StealthyFetcher (a real headless browser, so most bot protection that blocks
a plain HTTP request lets it through) and returns what it could find:

    {"status": 200, "title": "...", "price": 85000, "currency": "AED",
     "source": "json-ld" | "meta" | "text" | null, "blocked": false}

`blocked` means the site served a bot-protection page instead of the listing.
`gone_hint` means no price was found and the page says the ad is gone ("no
longer available", "listing expired"...) — for sites that don't 404.
`images` lists the listing's photo URLs (see extract_images in details.py);
the app downloads them itself.

POST /extract {"url": "..."} does the same fetch and also returns
"details" ({make, model, year, km, cylinders, spec, exterior_color,
interior_color, ad_placed_at} — whichever were found) plus "detail_sources"
saying which layer each came from. See details.py; nothing is site-specific.

Either one with "progress": true in the body streams newline-delimited JSON
instead — each step as it starts and ends, then the result (see _stream).

`source` says how confident to be: "json-ld"/"meta" come from the page's own
structured data (what the site tells search engines the price is), "text" is
a best-effort regex over the visible page text and can pick up the wrong
number (a monthly payment, a similar-car widget...).

Standard library only, apart from Scrapling itself. Fetches are serialized
behind a lock — one headless browser at a time is plenty for a button that
gets clicked by hand, and keeps memory use predictable.
"""

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scrapling.fetchers import StealthyFetcher

from details import best_srcset, extract_details, extract_images, is_index_page, parse_json_blobs, walk_single

PORT = int(os.environ.get("PORT", "8000"))
FETCH_TIMEOUT_MS = int(os.environ.get("FETCH_TIMEOUT_MS", "60000"))

fetch_lock = threading.Lock()

CURRENCY_RE = r"AED|USD|EUR|GBP|SAR|QAR|OMR|KWD|BHD|Dhs?\.?"
TEXT_PRICE_RE = re.compile(rf"\b({CURRENCY_RE})\s*([0-9]{{1,3}}(?:,[0-9]{{3}})+|[0-9]{{4,}})\b", re.IGNORECASE)


def parse_price(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    digits = re.sub(r"[^0-9.]", "", str(value))
    try:
        n = float(digits)
    except ValueError:
        return None
    return n if n > 0 else None


def normalize_currency(value):
    if not value:
        return None
    c = str(value).strip().upper().rstrip(".")
    return "AED" if c in ("DH", "DHS") else c


def from_json_ld(page):
    for data in parse_json_blobs(page.css('script[type="application/ld+json"]::text').getall()):
        # walk_single: an Offer inside an ItemList is some other car's price.
        for obj in walk_single(data):
            offers = obj.get("offers")
            candidates = list(offers) if isinstance(offers, list) else [offers]
            # Offer objects found while walking also count on their own.
            if str(obj.get("@type", "")).lower() in ("offer", "aggregateoffer"):
                candidates.append(obj)
            for offer in candidates:
                if not isinstance(offer, dict):
                    continue
                price = parse_price(offer.get("price") or offer.get("lowPrice"))
                if price:
                    return price, normalize_currency(offer.get("priceCurrency"))
    return None


def from_meta(page):
    for prop in ("product:price:amount", "og:price:amount"):
        price = parse_price(page.css(f'meta[property="{prop}"]::attr(content)').get())
        if price:
            currency_prop = prop.replace("amount", "currency")
            currency = page.css(f'meta[property="{currency_prop}"]::attr(content)').get()
            return price, normalize_currency(currency)
    price = parse_price(page.css('[itemprop="price"]::attr(content)').get())
    if price:
        currency = page.css('[itemprop="priceCurrency"]::attr(content)').get()
        return price, normalize_currency(currency)
    return None


def from_text(html):
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    match = TEXT_PRICE_RE.search(text)
    if not match:
        return None
    return parse_price(match.group(2)), normalize_currency(match.group(1))


GONE_RE = re.compile(
    r"\b(no longer available|has been (?:removed|deleted|sold)|ad (?:has )?expired|listing (?:has )?expired"
    r"|this (?:ad|listing|car) (?:is|has been) (?:no longer|removed|sold|deleted|expired))\b",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", re.DOTALL | re.IGNORECASE)

# Interstitials bot protection serves in place of the real page, with a 200 —
# Imperva ("Pardon Our Interruption", dubizzle), Cloudflare, Akamai.
BLOCK_TITLES = ("pardon our interruption", "just a moment", "attention required", "access denied")
# Some block pages have no <title> at all — e.g. Imperva's hard block, "Request
# unsuccessful. Incapsula incident ID: …", served once an IP is rate-limited.
BLOCK_BODY_RE = re.compile(
    r"Incapsula incident ID|_Incapsula_Resource|Request unsuccessful|cf-browser-verification|Access Denied",
    re.IGNORECASE,
)


def html_image_urls(page):
    """Every image URL the markup references, in document order — lazy-load
    attributes and the largest srcset candidate included."""
    urls = []
    for el in page.css("img, source, a"):
        attrs = el.attrib
        if el.tag == "a":
            href = attrs.get("href") or ""
            if re.search(r"\.(?:jpe?g|png|webp|avif)(?:\?|$)", href, re.IGNORECASE):
                urls.append(href)
            continue
        for name in ("src", "data-src", "data-lazy-src", "data-original"):
            if attrs.get(name):
                urls.append(attrs[name])
        for name in ("srcset", "data-srcset"):
            best = best_srcset(attrs.get(name))
            if best:
                urls.append(best)
    return urls


SOURCE_NAMES = {"json-ld": "structured data", "meta": "page tags", "text": "page text"}


def scrape(url, with_details=False, progress=None):
    """`progress(step, state, detail=None)`, when given, is told as each step
    starts and ends — what the live scan page shows. Steps: queue, load,
    settle, blocked, price, photos."""
    step = progress or (lambda *_args, **_kwargs: None)

    def loaded(pg):
        # Scrapling calls this once the page has loaded, just before the
        # `wait` below — so it splits "loading" from "waiting out the check".
        try:
            title = (pg.title() or "").strip()
        except Exception:  # noqa: BLE001 — only a label
            title = ""
        step("load", "done", f"“{title[:80]}”" if title else None)
        step("settle", "start")
        return pg

    step("queue", "start")
    with fetch_lock:
        step("queue", "done")
        step("load", "start")
        # The `wait` is what gets past dubizzle's Imperva check: its
        # interstitial runs a JS challenge and then reloads into the real
        # listing, which takes a few seconds after the network first idles.
        page = StealthyFetcher.fetch(
            url,
            headless=True,
            network_idle=True,
            wait=8000,
            google_search=False,
            timeout=FETCH_TIMEOUT_MS,
            page_action=loaded if progress else None,
        )
    step("settle", "done")

    step("blocked", "start")
    status = getattr(page, "status", None)
    title = (page.css("title::text").get() or "").strip() or None
    html = (page.body or b"").decode(getattr(page, "encoding", None) or "utf-8", errors="replace")
    blocked = (bool(title) and title.lower().startswith(BLOCK_TITLES)) or (
        # Block pages are tiny; a real listing that merely mentions one of
        # these strings is not.
        len(html) < 20000 and bool(BLOCK_BODY_RE.search(html))
    )
    result = {"status": status, "title": title, "price": None, "currency": None, "source": None, "blocked": blocked}
    if blocked:
        step("blocked", "failed", "Bot protection served a block page")
        return result
    step("blocked", "done", f"HTTP {status}" if status else None)

    step("price", "start")
    # Landed on a search/category page instead of the listing — what some
    # sites redirect a removed ad to. Every price on it is another car's.
    if is_index_page(parse_json_blobs(page.css('script[type="application/ld+json"]::text').getall())):
        result["gone_hint"] = True
        if with_details:
            result["details"], result["detail_sources"] = {}, {}
        result["images"] = []
        step("price", "done", "Landed on a search page — the ad is gone")
        return result

    extractors = (
        ("json-ld", lambda: from_json_ld(page)),
        ("meta", lambda: from_meta(page)),
        ("text", lambda: from_text(html)),
    )
    for source, extract in extractors:
        found = extract()
        if found and found[0]:
            result["price"], result["currency"] = found
            result["source"] = source
            break

    # Sites that don't 404 a delisted ad usually say so in the page instead.
    # Only trusted when no price was found, so a live listing that merely
    # mentions "sold" somewhere (a "recently sold" widget) isn't flagged.
    result["gone_hint"] = result["price"] is None and bool(GONE_RE.search(" ".join(TAG_RE.sub(" ", html).split())))
    if result["price"] is not None:
        price_note = f"{result['currency'] or ''} {round(result['price']):,} · from {SOURCE_NAMES[result['source']]}"
    else:
        price_note = "No price — the page says the ad is gone" if result["gone_hint"] else "No price found"
    step("price", "done", price_note.strip())

    step("photos", "start")
    try:
        result["images"] = extract_images(
            page.css('script[type="application/ld+json"]::text').getall(),
            page.css('script[type="application/json"]::text').getall(),
            html_image_urls(page),
            page.css('meta[property="og:image"]::attr(content)').getall(),
            base=getattr(page, "url", None) or url,
        )
    except Exception:  # noqa: BLE001 — photos are a bonus; never fail the price check over them
        result["images"] = []
    count = len(result["images"])
    step("photos", "done", f"{count} photo{'' if count == 1 else 's'} found")

    if with_details:
        description = page.css('meta[name="description"]::attr(content)').get() or page.css(
            'meta[property="og:description"]::attr(content)'
        ).get()
        result["details"], result["detail_sources"] = extract_details(
            page.css('script[type="application/ld+json"]::text').getall(),
            page.css('script[type="application/json"]::text').getall(),
            html,
            title or "",
            description or "",
        )
    return result


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self):
        if self.path not in ("/scrape", "/extract"):
            self._send(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            url = body.get("url", "")
        except (ValueError, AttributeError):
            self._send(400, {"error": 'Body must be JSON: {"url": "..."}'})
            return
        if not re.match(r"^https?://", str(url)):
            self._send(400, {"error": "A http(s) url is required."})
            return
        with_details = self.path == "/extract"
        if body.get("progress"):
            self._stream(url, with_details)
            return
        try:
            self._send(200, scrape(url, with_details=with_details))
        except Exception as err:  # noqa: BLE001 — report any fetch failure back to the app
            self._send(502, {"error": f"Fetch failed: {err}"})

    def _stream(self, url, with_details):
        """{"progress": true}: newline-delimited JSON instead — a
        {"step", "state", "detail"} line as each step starts and ends, then
        {"result": ...} or {"error": ...}. HTTP/1.0, so the body simply ends
        when the connection closes."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()

        def line(obj):
            try:
                self.wfile.write(json.dumps(obj).encode() + b"\n")
                self.wfile.flush()
            except OSError:
                pass  # The app gave up (stopped scan, timeout) — finish quietly.

        def progress(step, state, detail=None):
            line({"step": step, "state": state, **({"detail": detail} if detail else {})})

        try:
            line({"result": scrape(url, with_details=with_details, progress=progress)})
        except Exception as err:  # noqa: BLE001 — report any fetch failure back to the app
            line({"error": f"Fetch failed: {err}"})


if __name__ == "__main__":
    print(f"CarPulse scraper listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
