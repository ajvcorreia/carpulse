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
  // "Undo last change" (lib/undo.ts): each change's affected cars as they
  // were before it, as a JSON snapshot of their rows.
  {
    version: "0006_undo_log",
    sql: `
      create table undo_log (
        id text primary key,
        label text not null,
        car_ids text not null,
        snapshot text not null,
        created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
  },
  // When a car was marked removed, so a scheduled scan can strike out cars
  // that have stayed removed too long (lib/scan.ts). Kept by triggers rather
  // than by each place that flips is_removed — scans, the card's button, the
  // API, relists, imports, undo — so none can forget it.
  //
  // Cars already removed get the start of the scan that marked them removed
  // (the latest, if more than one did), else now: removed by hand, or before
  // scans kept summaries — their 30 days start today.
  {
    version: "0007_removed_at",
    sql: `
      alter table cars add column removed_at text;

      update cars set removed_at = coalesce(
        (select max(r.started_at) from scan_runs r, json_each(r.summary, '$.removed') j
         where json_valid(r.summary) and json_extract(j.value, '$.id') = cars.id),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      where is_removed = 1;

      create trigger cars_removed_at_update after update of is_removed on cars
      when new.is_removed is not old.is_removed
      begin
        update cars set removed_at = case when new.is_removed = 1
          then strftime('%Y-%m-%dT%H:%M:%fZ', 'now') else null end
        where id = new.id;
      end;

      create trigger cars_removed_at_insert after insert on cars
      when new.is_removed = 1 and new.removed_at is null
      begin
        update cars set removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
      end;
    `,
  },
  // Sign-in (lib/auth.ts): one row per signed-in browser, and the one-time
  // links "Forgot password?" emails. Both keep only a SHA-256 of the token
  // the browser or link holds, so a copy of the database can't sign anyone
  // in. `persistent` = "Keep me signed in" was ticked.
  {
    version: "0008_auth",
    sql: `
      create table auth_sessions (
        id text primary key,
        persistent integer not null,
        created_at text not null,
        last_seen_at text not null,
        expires_at text not null,
        ip text,
        user_agent text
      );

      create table auth_reset_tokens (
        id text primary key,
        created_at text not null,
        expires_at text not null,
        used_at text
      );
    `,
  },
];
