-- DubbizleWatch schema: manually-entered cars (by Dubizzle listing URL) and
-- their price history over time. Single-user tool with no login — access
-- control relies on the VM being on a private network, not app-level auth.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.cars (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  make text not null,
  model text not null,
  year integer not null check (year between 1980 and 2100),
  km integer check (km >= 0),
  spec text,
  ad_placed_at date,
  created_at timestamptz not null default now()
);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars (id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'AED',
  recorded_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index price_history_car_recorded_idx on public.price_history (car_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- latest_car_prices: most recent price_history row per car, joined with cars.
-- security_invoker: without it, the view runs as its owner and silently
-- bypasses the RLS policies on cars/price_history below.
-- ---------------------------------------------------------------------------

create view public.latest_car_prices with (security_invoker = true) as
select distinct on (c.id)
  c.id as car_id,
  c.url,
  c.make,
  c.model,
  c.year,
  c.km,
  c.spec,
  c.ad_placed_at,
  c.created_at,
  ph.price,
  ph.currency,
  ph.recorded_at as price_recorded_at
from public.cars c
left join public.price_history ph on ph.car_id = c.id
order by c.id, ph.recorded_at desc, ph.created_at desc;

-- ---------------------------------------------------------------------------
-- Row Level Security — no login, so the app talks to Postgres as `anon`.
-- RLS is enabled with a permissive policy anyway so a future auth layer is
-- a policy change, not a schema change.
-- ---------------------------------------------------------------------------

alter table public.cars enable row level security;
alter table public.price_history enable row level security;

create policy "anon manages cars" on public.cars
  for all to anon using (true) with check (true);

create policy "anon manages price history" on public.price_history
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Grants — RLS restricts rows, but PostgREST checks these table/view-level
-- privileges first; Supabase does not auto-grant them to app roles.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon;

grant select, insert, update, delete on public.cars to anon;
grant select, insert, update, delete on public.price_history to anon;
grant select on public.latest_car_prices to anon;
