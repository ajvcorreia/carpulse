"""Site-agnostic extraction of a car listing's details.

Nothing here knows about any particular site. Four layers, most to least
trustworthy, each only filling fields the layers before it left empty:

1. schema.org Vehicle/Car/Product JSON-LD — the standard listing sites embed
   for search engines (brand, model, vehicleModelDate, mileageFromOdometer,
   color, vehicleInteriorColor, offers...).
2. The page's app state (window.__X__ = {...}): the object with make,
   model and year keys — see from_app_state.
3. Label/value spec pairs, matched by the *label text* ("Regional Specs",
   "No. of Cylinders", "Exterior Colour"...) wherever they appear: as
   {"label": ..., "value": ...}-shaped objects in any JSON the page embeds
   (Next.js/Nuxt state, application/json scripts), or as a label element
   followed by a value element in the HTML (dt/dd, th/td, div/span pairs).
4. Regexes over the title + description ("GCC Specs", "2,500 km") as a last
   resort.

Pure functions over strings — no fetching — so this can be tested on its own.
"""

import json
import re
from datetime import datetime, timezone

# Normalized label text -> field. Normalization lowercases and strips
# punctuation, so "No. of Cylinders:" and "no of cylinders" both match.
LABELS = {
    "make": "make",
    "brand": "make",
    "manufacturer": "make",
    "model": "model",
    "year": "year",
    "model year": "year",
    "year of manufacture": "year",
    "manufacturing year": "year",
    "registration year": "year",
    "kilometers": "km",
    "kilometres": "km",
    "km": "km",
    "kms": "km",
    "mileage": "km",
    "odometer": "km",
    "no of cylinders": "cylinders",
    "number of cylinders": "cylinders",
    "cylinders": "cylinders",
    "engine cylinders": "cylinders",
    "regional specs": "spec",
    "regional spec": "spec",
    "regional specification": "spec",
    "specs": "spec",
    "specification": "spec",
    "specifications": "spec",
    "exterior color": "exterior_color",
    "exterior colour": "exterior_color",
    "color": "exterior_color",
    "colour": "exterior_color",
    "body color": "exterior_color",
    "body colour": "exterior_color",
    "interior color": "interior_color",
    "interior colour": "interior_color",
    "date posted": "ad_placed_at",
    "posted on": "ad_placed_at",
    "posted": "ad_placed_at",
    "listed on": "ad_placed_at",
    "ad posted": "ad_placed_at",
}

LABEL_KEYS = ("label", "name", "key", "title", "attribute", "displayName", "display_name")
VALUE_KEYS = ("value", "displayValue", "display_value", "val", "text", "formattedValue", "formatted_value")

SPEC_RE = re.compile(
    r"\b(GCC|American|US|USA|European|Euro|Japanese|Canadian|Korean|Chinese)\s+Spec(?:s|ification)?\b",
    re.IGNORECASE,
)
KM_RE = re.compile(r"\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,7})\s*(?:km|kms|kilometers|kilometres)\b", re.IGNORECASE)
MILES_UNITS = ("SMI", "MI", "MILE", "MILES")
PLACEHOLDERS = {"", "other", "other color", "other colour", "others", "n a", "na", "none", "unknown", "not specified", "not available"}


def norm_label(text):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", str(text).lower())).strip()


def clean_text(value):
    if isinstance(value, dict):
        value = value.get("name") or value.get("value")
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None or isinstance(value, (dict, list)):
        return None
    s = re.sub(r"\s+", " ", str(value)).strip()
    # Placeholder values sites show for "not specified" — filling the form
    # with them is worse than leaving the field empty.
    if norm_label(s) in PLACEHOLDERS:
        return None
    return s or None


def to_int(value, lo=None, hi=None):
    if value is None:
        return None
    m = re.search(r"[0-9][0-9,.]*", str(value))
    if not m:
        return None
    try:
        n = int(float(m.group(0).replace(",", "")))
    except ValueError:
        return None
    if (lo is not None and n < lo) or (hi is not None and n > hi):
        return None
    return n


def to_km(value):
    return to_int(value, 0, 2_000_000)


def to_year(value):
    m = re.search(r"\b(19[5-9][0-9]|20[0-9]{2})\b", str(value or ""))
    return int(m.group(1)) if m else None


def to_cylinders(value):
    m = re.search(r"\b[VWIH]?([0-9]{1,2})\b", str(value or ""), re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 16 else None


def to_spec(value):
    s = clean_text(value)
    if not s:
        return None
    m = SPEC_RE.search(s)
    if m:
        region = m.group(1)
        region = {"us": "American", "usa": "American", "euro": "European", "gcc": "GCC"}.get(
            region.lower(), region.title()
        )
        return f"{region} Specs"
    # A bare region ("GCC", "American") from a "Regional Specs" field.
    if len(s) <= 20 and not re.search(r"[0-9]", s):
        return s if s.lower().endswith("specs") else f"{s} Specs"
    return None


def to_date(value):
    """ISO date (YYYY-MM-DD) from an ISO-ish string or a unix timestamp."""
    if value is None:
        return None
    if isinstance(value, (int, float)) or re.fullmatch(r"[0-9]{9,13}", str(value).strip()):
        n = float(value)
        if n > 1e12:  # milliseconds
            n /= 1000
        try:
            return datetime.fromtimestamp(n, tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    m = re.search(r"\b(20[0-9]{2})-([01][0-9])-([0-3][0-9])", str(value))
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


CONVERTERS = {
    "make": clean_text,
    "model": clean_text,
    "year": to_year,
    "km": to_km,
    "cylinders": to_cylinders,
    "spec": to_spec,
    "exterior_color": clean_text,
    "interior_color": clean_text,
    "ad_placed_at": to_date,
}


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


# Containers that hold *other* listings — a search/category page, or a
# "similar cars" carousel. Nothing inside them describes the car at the URL.
LIST_TYPES = {"itemlist", "listitem", "collectionpage", "searchresultspage", "offercatalog"}
VEHICLE_TYPES = {"vehicle", "car", "product", "individualproduct"}


def walk_single(node):
    """Like walk(), but never descends into a list of other listings."""
    if isinstance(node, dict):
        if type_names(node) & LIST_TYPES:
            return
        yield node
        for k, v in node.items():
            if k not in ("itemListElement", "isSimilarTo", "isRelatedTo"):
                yield from walk_single(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_single(v)


def walk_past_breadcrumbs(node):
    """Like walk(), but skips BreadcrumbLists — their ListItems are links up
    the site ("Home › Used BMW cars"), not a list of other cars."""
    if isinstance(node, dict):
        if "breadcrumblist" in type_names(node):
            return
        yield node
        for v in node.values():
            yield from walk_past_breadcrumbs(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk_past_breadcrumbs(v)


def is_index_page(ld_docs):
    """A search/category page rather than one listing: it carries a list of
    cars and no car of its own. Some sites (DubiCars) redirect a removed ad to
    exactly such a page, with a 200, so its prices belong to other cars.
    A breadcrumb trail doesn't count — Cars24 listings carry one and nothing
    else."""
    has_list = any(type_names(o) & LIST_TYPES for d in ld_docs for o in walk_past_breadcrumbs(d))
    has_single = any(type_names(o) & VEHICLE_TYPES for d in ld_docs for o in walk_single(d))
    return has_list and not has_single


def parse_json_blobs(blobs):
    parsed = []
    for raw in blobs:
        try:
            parsed.append(json.loads(raw))
        except (ValueError, TypeError):
            continue
    return parsed


def type_names(obj):
    t = obj.get("@type")
    types = t if isinstance(t, list) else [t]
    return {str(x).lower() for x in types if x}


def first(value):
    return value[0] if isinstance(value, list) and value else value


def from_json_ld(ld_docs):
    found = {}
    for doc in ld_docs:
        for obj in walk_single(doc):
            types = type_names(obj)
            if not types & VEHICLE_TYPES:
                continue
            # A bare Product only counts if it looks like a vehicle.
            if types <= {"product", "individualproduct"} and not (
                "mileageFromOdometer" in obj or "vehicleModelDate" in obj
            ):
                continue
            mileage = obj.get("mileageFromOdometer")
            if isinstance(mileage, dict):
                km = to_km(mileage.get("value"))
                if km is not None and str(mileage.get("unitCode", "")).upper() in MILES_UNITS:
                    km = round(km * 1.609344)
            else:
                km = to_km(mileage)
            engine = first(obj.get("vehicleEngine"))
            offers = first(obj.get("offers"))
            offers = offers if isinstance(offers, dict) else {}
            candidates = {
                "make": obj.get("brand") or obj.get("manufacturer"),
                "model": obj.get("model"),
                "year": obj.get("vehicleModelDate") or obj.get("modelDate") or obj.get("productionDate"),
                "km": km,
                "cylinders": (engine.get("engineCylinders") if isinstance(engine, dict) else None)
                or obj.get("numberOfCylinders"),
                "spec": obj.get("regionalSpecs"),
                "exterior_color": obj.get("color"),
                "interior_color": obj.get("vehicleInteriorColor"),
                "ad_placed_at": offers.get("availabilityStarts") or obj.get("datePosted") or obj.get("datePublished"),
            }
            for field, raw in candidates.items():
                if field in found or raw is None:
                    continue
                value = raw if field == "km" else CONVERTERS[field](raw)
                if value is not None:
                    found[field] = value
    return found


def from_json_pairs(docs):
    found = {}
    for doc in docs:
        for obj in walk(doc):
            label = next((obj[k] for k in LABEL_KEYS if isinstance(obj.get(k), str)), None)
            if label is None:
                continue
            field = LABELS.get(norm_label(label))
            if not field or field in found:
                continue
            raw = next((obj[k] for k in VALUE_KEYS if isinstance(obj.get(k), (str, int, float))), None)
            value = CONVERTERS[field](raw) if raw is not None else None
            if value is not None:
                found[field] = value
    return found


# --- The page's own app state ---------------------------------------------
#
# Sites that skip schema.org often still ship the listing to the browser as
# JSON — `window.__PRELOADED_STATE__ = {...}` (Cars24), __NEXT_DATA__... — as
# a plain object with make/model/year keys. The same state usually holds
# other cars too ("similar cars"), so the listing is taken to be the
# shallowest object with all three, and if two different cars tie for that,
# neither: a search page's state is a list of cars, none of them the one.

APP_STATE_RE = re.compile(r"^\s*window\.__[A-Za-z0-9_]+__\s*=\s*(\{.*\})\s*;?\s*$", re.DOTALL)
OTHER_CARS_KEY_RE = re.compile(r"similar|related|recommend|recent|suggest|compare|wishlist|other|more", re.IGNORECASE)
STATE_KEYS = {
    "make": ("make", "makeName", "brand", "brandName", "manufacturer"),
    "model": ("model", "modelName"),
    "year": ("year", "modelYear", "manufacturingYear", "yearOfManufacture"),
    "km": ("odometerReading", "odometer", "mileage", "kilometers", "kilometres", "km", "kms"),
    "cylinders": ("cylinders", "noOfCylinders", "numberOfCylinders", "engineCylinders"),
    "spec": ("regionalSpecs", "regionalSpec", "specs"),
    "exterior_color": ("exteriorColor", "exteriorColour", "color", "colour", "bodyColor"),
    "interior_color": ("interiorColor", "interiorColour"),
}


def app_state_blobs(scripts):
    """The JSON assigned to `window.__X__` in inline scripts."""
    return [m.group(1) for s in scripts if s and (m := APP_STATE_RE.match(s))]


def state_value(obj, field):
    for key in STATE_KEYS[field]:
        value = obj.get(key)
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            return value
    return None


def state_listing(docs):
    """The listing's own car object in the page's app state, or None."""
    best_depth, cars = None, []

    def visit(node, depth):
        nonlocal best_depth, cars
        if isinstance(node, dict):
            if all(state_value(node, f) is not None for f in ("make", "model", "year")):
                if best_depth is None or depth < best_depth:
                    best_depth, cars = depth, [node]
                elif depth == best_depth:
                    cars.append(node)
            for k, v in node.items():
                if not OTHER_CARS_KEY_RE.search(str(k)):
                    visit(v, depth + 1)
        elif isinstance(node, list):
            for v in node:
                visit(v, depth + 1)

    for doc in docs:
        visit(doc, 0)
    if not cars or len({tuple(str(state_value(c, f)) for f in ("make", "model", "year")) for c in cars}) > 1:
        return None
    return cars[0]


def from_app_state(docs):
    car = state_listing(docs)
    found = {}
    if car is None:
        return found
    for field in STATE_KEYS:
        raw = state_value(car, field)
        value = CONVERTERS[field](raw) if raw is not None else None
        if value is not None:
            found[field] = value
    return found


PRICE_KEYS = ("price", "listingPrice", "sellingPrice", "askingPrice")
CURRENCY_KEYS = ("currency", "priceCurrency", "currencyCode")


def app_state_price(docs):
    """(price, currency or None) from the listing's app-state object. Pages
    that render client-side put loan and down-payment figures ahead of the
    price in their text, so the text regex can't be trusted on them."""
    car = state_listing(docs)
    if car is None:
        return None
    for key in PRICE_KEYS:
        value = car.get(key)
        if isinstance(value, (int, float, str)) and not isinstance(value, bool):
            price = to_int(value, 1)
            if price:
                currency = next((car[k] for k in CURRENCY_KEYS if isinstance(car.get(k), str)), None)
                return float(price), currency
    return None


TAG_RE = re.compile(r"<[^>]+>")


def html_text_nodes(html):
    """The page's text nodes in document order (scripts/styles dropped)."""
    html = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    nodes = []
    for chunk in TAG_RE.split(html):
        text = re.sub(r"\s+", " ", chunk.replace("&nbsp;", " ").replace("&amp;", "&")).strip()
        if text:
            nodes.append(text)
    return nodes


def from_html_pairs(html):
    """A text node that *is* a known label, followed by its value node —
    covers dt/dd, th/td and the label-div/value-div layouts most sites use.
    A label with an inline value ("Year: 2025") counts too."""
    found = {}
    nodes = html_text_nodes(html)
    for i, node in enumerate(nodes):
        if len(node) > 40:
            continue
        inline = re.match(r"^([^:]{2,30}):\s*(.+)$", node)
        if inline and LABELS.get(norm_label(inline.group(1))):
            field, raw = LABELS[norm_label(inline.group(1))], inline.group(2)
        else:
            field = LABELS.get(norm_label(node))
            raw = nodes[i + 1] if i + 1 < len(nodes) else None
            # Skip when the "value" is just another label (an empty row).
            if raw is not None and LABELS.get(norm_label(raw)):
                continue
        if not field or field in found or raw is None or len(raw) > 60:
            continue
        value = CONVERTERS[field](raw)
        if value is not None:
            found[field] = value
    return found


def from_text(text):
    found = {}
    m = SPEC_RE.search(text)
    if m:
        found["spec"] = to_spec(m.group(0))
    m = KM_RE.search(text)
    if m:
        km = to_km(m.group(1))
        if km is not None:
            found["km"] = km
    return found


def extract_details(ld_blobs, json_blobs, html, title="", description=""):
    """Returns ({field: value}, {field: layer}) for whatever could be found.
    `json_blobs` is the page's embedded JSON — application/json scripts and
    app_state_blobs()."""
    # A search page's spec tables and text describe many cars, none of them
    # this one — better to fill nothing than another car's details.
    if is_index_page(parse_json_blobs(ld_blobs)):
        return {}, {}
    layers = (
        ("structured data", lambda: from_json_ld(parse_json_blobs(ld_blobs))),
        ("listing data", lambda: from_app_state(parse_json_blobs(json_blobs))),
        ("spec table", lambda: from_json_pairs(parse_json_blobs(json_blobs))),
        ("spec table", lambda: from_html_pairs(html)),
        ("page text", lambda: from_text(f"{title or ''}\n{description or ''}")),
    )
    fields, sources = {}, {}
    for layer, extract in layers:
        try:
            found = extract()
        except Exception:  # noqa: BLE001 — one bad layer shouldn't sink the others
            continue
        for field, value in found.items():
            if field not in fields and value is not None:
                fields[field] = value
                sources[field] = layer
    return fields, sources


# --- Photos ---------------------------------------------------------------
#
# Also site-agnostic, and anchored on what the page says is *this* car's
# picture: the schema.org `image` and og:image. Pages are full of other
# images (logos, icons, "similar cars"), so a gallery is only accepted if it
# contains one of those anchors:
#
# 1. JSON-LD that already lists several images (the whole gallery).
# 2. An array in the page's embedded JSON (Next.js/Nuxt state...) holding
#    the anchor among other image URLs — e.g. a listing's `photos` field.
#    Bare paths ("cdn-bucket/1234/a.jpg", Cars24) resolve against the
#    anchor's host — page-relative image paths don't occur in such JSON.
# 3. <img>/<source>/<a> URLs in the HTML shaped like the anchor's: same host
#    and path pattern, differing only in the per-photo id segments — and,
#    when at least two share them, the anchor's own id *folders*: a site
#    that files photos by car id (/9718448765/IMG_1.jpg) has its "similar
#    cars" strip in the same shape, just under other ids.
# 4. Failing all that, just the anchors themselves.

MAX_PHOTOS = 40
IMAGE_EXT_RE = re.compile(r"\.(?:jpe?g|png|webp|avif)$", re.IGNORECASE)
ID_SEGMENT_RE = re.compile(r"^[0-9a-f-]{6,}$", re.IGNORECASE)
# Keys an image object in embedded JSON uses for its full-size URL, best first.
IMAGE_VALUE_KEYS = ("main", "large", "full", "original", "big", "xl", "url", "src", "href", "contentUrl", "uri", "path")


def absolute_url(url, base):
    from urllib.parse import urljoin

    if not isinstance(url, str):
        return None
    url = url.strip()
    if not url or url.startswith("data:"):
        return None
    url = urljoin(base, url) if base else url
    return url if re.match(r"^https?://", url) else None


def split_url(url):
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return parts.netloc.lower(), [s for s in parts.path.split("/") if s]


def image_key(url):
    """What identifies a photo across its size/format variants — usually the
    file name (an id or hash), with the extension and query dropped."""
    _, segments = split_url(url)
    if not segments:
        return url
    return IMAGE_EXT_RE.sub("", segments[-1]).lower()


def has_image_ext(url):
    _, segments = split_url(url)
    return bool(segments) and bool(IMAGE_EXT_RE.search(segments[-1]))


def image_shape(url):
    """The URL with its per-photo segments wildcarded:
    //cdn/images/a5235a/w_1300x760/sellers/<uuid>.jpg -> cdn/images/*/w_1300x760/sellers/*.jpg"""
    host, segments = split_url(url)
    if not segments:
        return host
    shaped = ["*" if ID_SEGMENT_RE.match(s) else s for s in segments[:-1]]
    ext = IMAGE_EXT_RE.search(segments[-1])
    shaped.append("*" + (ext.group(0).lower() if ext else ""))
    return host + "/" + "/".join(shaped)


def shape_size(shape):
    """Largest number in a shape — prefers the w_1300x760 variant of a
    gallery over its thumbnail strip when both contain every photo."""
    return max((int(n) for n in re.findall(r"[0-9]+", shape)), default=0)


def dedupe(urls):
    seen, out = set(), []
    for u in urls:
        k = image_key(u)
        if u and k not in seen:
            seen.add(k)
            out.append(u)
    return out[:MAX_PHOTOS]


def ld_images(ld_docs, base):
    found = []
    for doc in ld_docs:
        for obj in walk_single(doc):
            if not type_names(obj) & VEHICLE_TYPES:
                continue
            images = obj.get("image")
            for img in images if isinstance(images, list) else [images]:
                if isinstance(img, dict):
                    img = img.get("contentUrl") or img.get("url")
                url = absolute_url(img, base)
                if url:
                    found.append(url)
    return dedupe(found)


def image_from_item(item, anchor_keys, base, asset_base=None):
    """An image URL out of one array element (a string or an image object).
    `asset_base` (the anchor's origin) resolves bare paths."""
    if isinstance(item, str):
        bare = asset_base and not re.match(r"^(?:[a-z][a-z0-9+.-]*:|/)", item.strip(), re.IGNORECASE)
        url = absolute_url(item, asset_base + "/" if bare else base)
        return url if url and (has_image_ext(url) or image_key(url) in anchor_keys) else None
    if isinstance(item, dict):
        for k in IMAGE_VALUE_KEYS:
            url = image_from_item(item.get(k), anchor_keys, base, asset_base) if isinstance(item.get(k), str) else None
            if url:
                return url
        for v in item.values():
            url = image_from_item(v, anchor_keys, base, asset_base) if isinstance(v, str) else None
            if url:
                return url
    return None


def json_gallery(json_docs, anchor_keys, base, asset_base=None):
    best = []

    def visit(node):
        nonlocal best
        if isinstance(node, dict):
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            urls = [u for u in (image_from_item(x, anchor_keys, base, asset_base) for x in node) if u]
            if len(urls) >= 2 and any(image_key(u) in anchor_keys for u in urls):
                urls = dedupe(urls)
                if len(urls) > len(best):
                    best = urls
            for v in node:
                visit(v)

    for doc in json_docs:
        visit(doc)
    return best


def best_srcset(value):
    best, best_w = None, -1
    for part in (value or "").split(","):
        bits = part.strip().split()
        if not bits:
            continue
        w = re.match(r"^([0-9]+)[wx]$", bits[1]) if len(bits) > 1 else None
        width = int(w.group(1)) if w else 0
        if width >= best_w:
            best, best_w = bits[0], width
    return best


def id_folders(url):
    _, segments = split_url(url)
    return tuple(s.lower() for s in segments[:-1] if ID_SEGMENT_RE.match(s))


def html_gallery(html_urls, anchor_keys, base):
    urls = [u for u in (absolute_url(x, base) for x in html_urls) if u]
    shapes = {image_shape(u) for u in urls if image_key(u) in anchor_keys}
    best = []
    best_size = -1
    for shape in shapes:
        members = dedupe([u for u in urls if image_shape(u) == shape])
        folders = {id_folders(u) for u in members if image_key(u) in anchor_keys}
        same_car = [u for u in members if id_folders(u) in folders]
        if len(same_car) >= 2:
            members = same_car
        size = shape_size(shape)
        if len(members) > len(best) or (len(members) == len(best) and size > best_size):
            best, best_size = members, size
    return best


def extract_images(ld_blobs, json_blobs, html_urls, og_urls, base=None):
    """Returns this listing's photo URLs, gallery order, best size found."""
    ld_docs = parse_json_blobs(ld_blobs)
    if is_index_page(ld_docs):
        return []
    from_ld = ld_images(ld_docs, base)
    if len(from_ld) >= 2:
        return from_ld
    anchors = dedupe(from_ld + [u for u in (absolute_url(x, base) for x in og_urls) if u])
    if not anchors:
        return []
    anchor_keys = {image_key(u) for u in anchors}
    host = re.match(r"^https?://[^/]+", anchors[0])
    for gallery in (
        lambda: json_gallery(parse_json_blobs(json_blobs), anchor_keys, base, host.group(0) if host else None),
        lambda: html_gallery(html_urls, anchor_keys, base),
    ):
        try:
            found = gallery()
        except Exception:  # noqa: BLE001 — fall through to the next layer
            continue
        if len(found) >= 2:
            return found
    return anchors
