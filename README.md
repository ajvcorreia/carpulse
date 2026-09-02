# CarPulse

Track Dubizzle car listing prices over time. Manual entry, not a scraper —
Dubizzle sits behind Imperva Incapsula bot protection, so this app is built
around you pasting a listing URL yourself rather than automated crawling.

## How it works

- Paste a Dubizzle listing URL on the dashboard.
  - If it's already tracked, you land on that car's page and can log a new price.
  - If it's new, you fill in make/model/year/km/spec/ad placement date and the price.
- The dashboard lists every tracked car as an expandable row — collapsed shows
  make/model/price/year (and the full spec on desktop); expanding it reveals
  the price chart, full history, edit form, and actions (favorite, mark
  removed, strike out, "Ask Claude" for engine/reliability insights).
- A key-gated REST API (`/api/cars`) is also available for scripts/automation.

## Stack

Next.js (App Router) + Supabase (Postgres only — no auth). Single-user with
no login: access control is the VM being on a private network, not an app
login. Don't expose this beyond that network without adding auth back.

## Local development

```bash
npm install
npx supabase start   # local Postgres/Studio, ports set in supabase/config.toml
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in the values `supabase start`
prints (API URL + anon key). If you'd rather point at a hosted Supabase project
instead of running one locally, use its project URL and anon key the same way.

## Running with Docker

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` get baked into
the client bundle at build time (that's how Next.js handles `NEXT_PUBLIC_*`
vars), not read at container startup — so they're build args, not `docker run
-e`. `CARPULSE_API_KEY` isn't `NEXT_PUBLIC_*`; it's read server-side per
request, so that one *is* a normal runtime env var.

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t carpulse .

docker run -p 3000:3000 -e CARPULSE_API_KEY=your-api-key carpulse
```

Because the Supabase URL/key are baked in, an image only really works against
the one Supabase project it was built with — build your own rather than
expecting a pre-built image to point at your database.
