// Schema changes after the baseline (lib/db/schema.ts) go here as new
// entries, applied in array order and tracked in the schema_migrations
// table — same discipline as the old numbered Supabase migrations, just
// without an external CLI. Example:
//
//   { version: "0002_add_notes", sql: "alter table cars add column notes text;" }
export const MIGRATIONS: { version: string; sql: string }[] = [];
