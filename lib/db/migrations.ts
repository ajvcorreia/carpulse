// Schema changes after the baseline (lib/db/schema.ts) go here as new
// entries, applied in array order and tracked in the schema_migrations
// table — same discipline as the old numbered Supabase migrations, just
// without an external CLI. Example:
//
//   { version: "0002_add_notes", sql: "alter table cars add column notes text;" }
export const MIGRATIONS: { version: string; sql: string }[] = [
  // Tracks URL/ad-placement changes so a removed ad that gets re-posted
  // under a new URL can be merged back into its existing car (same price
  // history, just a new listing) instead of starting over as an unrelated
  // car with a blank history.
  {
    version: "0002_add_listing_history",
    sql: `
      create table listing_history (
        id text primary key,
        car_id text not null references cars (id) on delete cascade,
        previous_url text not null,
        previous_ad_placed_at text,
        replaced_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      create index listing_history_car_idx on listing_history (car_id, replaced_at);
    `,
  },
  // "Also listed at" — the same physical car posted on more than one site at
  // once, each with its own independent status/price history (unlike a
  // relist, where one listing replaces another). group_id points at the
  // group's anchor car; the anchor's own group_id stays null. A car with no
  // group_id and nothing else pointing at it isn't in a group at all.
  {
    version: "0003_add_group_id",
    sql: `alter table cars add column group_id text references cars (id);`,
  },
  // App settings (automatic scan schedule, email/SMTP) as JSON blobs keyed
  // by section — see lib/settings.ts — plus a history of scan runs, each
  // with its progress and a JSON summary of what it changed.
  {
    version: "0004_settings_and_scans",
    sql: `
      create table settings (
        key text primary key,
        value text not null
      );

      create table scan_runs (
        id text primary key,
        trigger text not null,
        status text not null,
        started_at text not null,
        finished_at text,
        total integer not null default 0,
        checked integer not null default 0,
        summary text
      );

      create index scan_runs_started_idx on scan_runs (started_at desc);
    `,
  },
  // Listing photos downloaded by the scraper (lib/photos.ts). The image files
  // themselves live on disk next to the database; `file` is the path relative
  // to the photos directory, so rows can move between cars (a merge) without
  // moving files.
  {
    version: "0005_car_photos",
    sql: `
      create table car_photos (
        id text primary key,
        car_id text not null references cars (id) on delete cascade,
        position integer not null,
        file text not null,
        content_type text not null,
        source_url text,
        created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      create index car_photos_car_idx on car_photos (car_id, position);
    `,
  },
];
