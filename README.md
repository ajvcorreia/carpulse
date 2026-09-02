# CarPulse

Track Dubizzle car listing prices over time. Manual entry, not a scraper —
Dubizzle sits behind Imperva Incapsula bot protection, so this app is built
around you pasting a listing URL yourself rather than automated crawling.

## How it works

- Paste a Dubizzle listing URL on the dashboard.
  - If it's already tracked, you land on that car's page and can log a new price.
  - If it's new, you fill in make/model/year/km/spec/ad placement date and the price.
- The dashboard lists every tracked car with its latest price, the change since
  the last update, and a sparkline of price history.
- Each car's page has the full price chart and history table.

## Stack

Next.js (App Router) + Supabase (Postgres only — no auth). Single-user with
no login: access control is the VM being on a private network, not an app
login. Don't expose this beyond that network without adding auth back.

## Local development

Local Supabase and the dev server run on the VM at `192.168.10.189` (matches
the [PriceWise](../PriceWise) project's setup):

```bash
npm install
npx supabase start   # local Postgres/Studio, ports set in supabase/config.toml
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in the values `supabase start`
prints (API URL + anon key).
