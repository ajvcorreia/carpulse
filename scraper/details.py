"""Site-agnostic extraction of a car listing's details.

Nothing here knows about any particular site. Three layers, most to least
trustworthy, each only filling fields the layers before it left empty:

1. schema.org Vehicle/Car/Product JSON-LD — the standard listing sites embed
   for search engines (brand, model, vehicleModelDate, mileageFromOdometer,
   color, vehicleInteriorColor, offers...).
2. Label/value spec pairs, matched by the *label text* ("Regional Specs",
   "No. of Cylinders", "Exterior Colour"...) wherever they appear: as
   {"label": ..., "value": ...}-shaped objects in any JSON the page embeds
   (Next.js/Nuxt state, application/json scripts), or as a label element
   followed by a value element in the HTML (dt/dd, th/td, div/span pairs).
3. Regexes over the title + description ("GCC Specs", "2,500 km") as a last
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
        for obj in walk(doc):
            types = type_names(obj)
            if not types & {"vehicle", "car", "product", "individualproduct"}:
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
    """Returns ({field: value}, {field: layer}) for whatever could be found."""
    layers = (
        ("structured data", lambda: from_json_ld(parse_json_blobs(ld_blobs))),
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
