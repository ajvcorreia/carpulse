// CarPulse schema (SQLite). Consolidates what were 7 incremental Postgres
// migrations under Supabase into one baseline — this runs once, against a
// fresh file, so there's nothing to replay.
//
// A plain string constant rather than a sibling .sql file read via fs at
// runtime: Next.js's build output (especially the standalone trace used for
// Docker) only bundles files that are actually imported as modules, not
// arbitrary files read by path — a .sql file wouldn't reliably survive that.
//
// Deliberately dropped vs. the old Postgres schema: RLS policies, grants,
// and the latest_car_prices view. None of those concepts apply to a
// single-process file-backed database reached only by this app's own
// server code — they existed solely to satisfy PostgREST's privilege model.
export const SCHEMA_SQL = `
create table cars (
  id text primary key,
  url text not null unique,
  make text not null,
  model text not null,
  year integer not null check (year between 1980 and 2100),
  km integer check (km is null or km >= 0),
  cylinders integer check (cylinders is null or cylinders between 1 and 16),
  spec text,
  exterior_color text,
  interior_color text,
  ad_placed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_removed integer not null default 0,
  is_favorite integer not null default 0,
  is_struck_out integer not null default 0,
  strike_out_reason text,
  last_opened_at text
);

create table price_history (
  id text primary key,
  car_id text not null references cars (id) on delete cascade,
  price numeric not null check (price >= 0),
  currency text not null default 'AED',
  recorded_at text not null default (date('now')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index price_history_car_recorded_idx on price_history (car_id, recorded_at desc);

create table schema_migrations (
  version text primary key,
  applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export const BASELINE_VERSION = "0001_init";
