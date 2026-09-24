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
];
