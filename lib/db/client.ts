import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BASELINE_VERSION, SCHEMA_SQL } from "@/lib/db/schema";
import { MIGRATIONS } from "@/lib/db/migrations";

// Statically scoped to <cwd>/data so Next's build-time file tracing doesn't
// conservatively bundle the whole project (it can't resolve an arbitrary
// env-var path at build time, and defensively includes everything when it
// can't prove otherwise).
//
// `||` rather than `??`: an unset-but-present DATABASE_PATH=  in .env.local
// loads as "", and "" is not nullish, so `??` would pass it straight to
// DatabaseSync — which treats "" as an anonymous temp database, not "use the
// default path". Blank must mean "use the default" just like unset does.
const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), "data", "carpulse.db");

function applyMigrations(database: DatabaseSync) {
  const appliedRows = database.prepare("select version from schema_migrations").all() as {
    version: string;
  }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec(migration.sql);
    database.prepare("insert into schema_migrations (version) values (?)").run(migration.version);
  }
}

function openDatabase(): DatabaseSync {
  const dir = dirname(DB_PATH);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });

  const isNewDatabase = !existsSync(/* turbopackIgnore: true */ DB_PATH);
  const database = new DatabaseSync(DB_PATH);

  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  if (isNewDatabase) {
    database.exec(SCHEMA_SQL);
    database.prepare("insert into schema_migrations (version) values (?)").run(BASELINE_VERSION);
  }

  applyMigrations(database);

  return database;
}

// Module-level singleton — Next.js keeps this module instance alive across
// requests within one server process, so the file is opened once, not per
// request.
let instance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!instance) instance = openDatabase();
  return instance;
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
