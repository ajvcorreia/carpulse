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
- A key-gated REST API (`/api/cars`) is also available for scripts/automation.

## Stack

Next.js (App Router) + SQLite (via Node's built-in `node:sqlite`) — no auth.
Single-user with no login: access control is the VM being on a private
network, not an app login. Don't expose this beyond that network without
adding auth back. The whole database is one file; back it up by copying it.

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
