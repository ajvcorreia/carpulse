# CarPulse

Track car listing prices over time, from any car sales site. Manual entry,
not a scraper — most listing sites sit behind bot protection, so this app is
built around you pasting a listing URL yourself rather than automated
crawling.

## How it works

- Paste a car listing URL on the dashboard.
  - If it's already tracked, you land on that car's page and can log a new price.
  - If it's new, you fill in make/model/year/km/spec/ad placement date and the price.
- The dashboard lists every tracked car as an expandable row — collapsed shows
  make/model/price/year (and the full spec on desktop); expanding it reveals
  the price chart, full history, edit form, and actions (favorite, mark
  removed, strike out, "Ask Claude" for engine/reliability insights).
- A key-gated REST API (`/api/**`) covers everything the UI does, for
  scripts/automation and native clients such as the CarPulse iOS app (see
  [REST API](#rest-api)).

### Checking a listing for updates (experimental)

Each expanded card has a **Check listing for updates** button. It asks a
small sidecar service (`scraper/`, built on
[Scrapling](https://github.com/D4Vinci/Scrapling)'s headless-browser
`StealthyFetcher`) to load the listing and read its price — from the page's
structured data (JSON-LD / price meta tags) when the site provides it, falling
back to a guess from the page text. A structured-data price that differs from
the latest one is logged straight away; a text guess is shown with a "Save it
anyway" link instead, since it can pick up the wrong number. A 404/410 is
reported as a likely removed listing.

Docker Compose runs the sidecar for you (`SCRAPER_URL` is preset). Without it,
the button just reports that no scraper is configured.

The same sidecar pre-fills the add-car form: it reads the listing's
schema.org vehicle data, spec tables, and description (nothing site-specific)
and fills any still-empty fields for you to review.

### Automatic scans

**Settings** (header link) turns on a daily or weekly scan at one or more
start times (add a time for each scan you want that day) in a set timezone. A
start time reached while a scan is still running is skipped. A scan checks every car that isn't struck out, one at a time with a
random pause between cars (configurable, 10–40s by default):

- **Price changed** — the new price is logged (only from the site's own
  price data, never a guess from page text).
- **Listing gone** (404/410, or a page saying it's no longer available) — the
  car is marked removed.
- **Removed car's listing is live again** — it's marked active.

Scans run inside the app process (started from `instrumentation.ts`); a run
missed while the app was down still starts later that day. The settings page
also has **Run scan now** / **Stop**, and shows what recent runs changed. To
get a summary by email after each scan, fill in the SMTP settings there — the
password is stored in the SQLite database, so treat the data volume as
sensitive.

While a scan runs, a **Watch live** button on the dashboard and in Settings
opens `/scan`: progress and time left, the car being checked or the pause
before the next one, running totals, and every car's result as it comes in
(also `GET /api/scans/live`).

### Undo and backups

The dashboard shows your last change — adding or relisting a car, a merge,
"also listed at", an edit, a price, a flag — with an **Undo** button that
puts the affected cars back exactly as they were. Press it again to step
further back (the last 20 changes are remembered). It restores whole cars,
so anything a scan changed on them since is undone too.

A copy of the database is also saved every day to `data/backups/` (override
with `BACKUP_DIR`), keeping the last 14. **Settings → Backups** lists them
for download and has **Back up now**. To restore one, stop the app and copy
it over `data/carpulse.db`. Listing photos aren't in the backups.

### Listing photos

Turn on **Save listing photos** in Settings and a car's photos are
downloaded the first time its listing is read: when you add it, click
**Check listing for updates**, or a scan reaches it. They show in the car's
expanded view as a carousel (arrow buttons, keyboard arrows, or swipe), and
stay after the ad is taken down. Cars that already have photos aren't
re-downloaded.

The gallery is found without site-specific code: the listing's schema.org
`image` list if it has several, otherwise an image array in the page's
embedded JSON or a set of `<img>` URLs shaped like the listing's main photo
(`og:image`). Files live in `data/photos/<car id>/` next to the database
(override with `PHOTOS_DIR`), so they're on the same Docker volume. They
aren't part of **Export**.

## Stack

Next.js (App Router) + SQLite (via Node's built-in `node:sqlite`). Single-user,
no accounts. By default access control is just the VM being on a private
network; set `AUTH_USERNAME`/`AUTH_PASSWORD` (see below) to put a login
prompt in front of the UI too. The whole database is one file; back it up by
copying it.

## Local development

```bash
npm install
npm run dev
```

Requires Node 22+ (for `node:sqlite`). Copy `.env.local.example` to
`.env.local` — `DATABASE_PATH` is optional and defaults to
`./data/carpulse.db`, created automatically on first run.

## Running with Docker

Pre-built images are published to Docker Hub as `ajvcorreia/carpulse` on
every push to `master` (see `.github/workflows/docker-publish.yml`).

### Docker Compose

```bash
echo "CARPULSE_API_KEY=your-api-key" > .env
docker compose up -d
```

Pulls `ajvcorreia/carpulse:latest` and stores the database in the
`carpulse-data` named volume. To build from source instead, uncomment
`build: .` in `docker-compose.yml`.

To require a login (HTTP Basic Auth) for the UI, also set `AUTH_USERNAME`
and `AUTH_PASSWORD` in `.env`:

```bash
echo "AUTH_USERNAME=your-username" >> .env
echo "AUTH_PASSWORD=your-password" >> .env
```

Leave either unset and the app stays open to anyone who can reach it, same
as before. This doesn't cover `/api/*` — that's gated separately by
`CARPULSE_API_KEY`.

### Plain `docker run`

```bash
docker build -t carpulse .

docker run -p 3000:3000 \
  -e CARPULSE_API_KEY=your-api-key \
  -v carpulse-data:/app/data \
  carpulse
```

The `-v carpulse-data:/app/data` volume is what makes the database survive
the container being recreated — without it, restarting the container starts
from an empty database. No project-specific build args needed: the same
image works for anyone, pointed at whatever volume they mount.

## REST API

Every `/api` route needs the `X-API-Key` header set to `CARPULSE_API_KEY`
(unaffected by `AUTH_USERNAME`/`AUTH_PASSWORD`). Bodies are JSON. Errors are
`{"error": "message"}`, or a list of validation issues for a malformed body.

| Method & path | What it does |
| --- | --- |
| `GET /api/cars` (`?url=` to look one up) | Every car with price history, listing history and photo ids |
| `POST /api/cars` | Add a car with its first price (optionally `also_listed_at_car_id`, `photo_urls`) |
| `GET` / `PATCH /api/cars/{id}` | One car / change details or flags (`is_favorite`, `is_removed`, `is_struck_out`, `strike_out_reason`) |
| `POST /api/cars/{id}/prices`, `DELETE /api/cars/{id}/prices/{priceId}` | Log / delete a price |
| `POST /api/cars/duplicate` | The add flow's "already tracked under another URL?" check |
| `POST /api/cars/{id}/relist` | Same car re-listed at a new URL (keeps its history) |
| `POST /api/cars/{id}/merge` | Merge `merge_from_car_id` into this car, with per-field picks |
| `POST` / `DELETE /api/cars/{id}/link` | "Also listed at" another car (`car_id`) / unlink |
| `POST /api/cars/{id}/opened` | Record that the listing was opened |
| `POST /api/cars/{id}/check` | Check the listing for updates (scraper sidecar) |
| `POST /api/listing-details` | Pre-fill details for a listing `url` (nothing saved) |
| `GET /api/photos/{id}` | A saved listing photo |
| `GET /api/options` | Make/model/spec suggestions |
| `GET /api/export`, `POST /api/import` | Same JSON as the UI's Export/Import |
| `GET /api/settings` | Scan, email (never the SMTP password) and photo settings |
| `PUT /api/settings/scan` / `email` / `photos`, `POST /api/settings/email/test` | Save settings / send a test email |
| `GET` / `POST /api/scans`, `POST /api/scans/stop` | Recent runs and whether one is running / start a scan / stop it |
| `GET /api/scans/live` | The running scan's live state: each car's result so far, what it's doing now |
| `GET` / `POST /api/undo` | The last undoable change / undo it (optional `id`: only if it's still the last) |
| `GET` / `POST /api/backups`, `GET /api/backups/{name}` | List backups / make one now / download one |
