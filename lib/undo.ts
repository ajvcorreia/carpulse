import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, withTransaction } from "@/lib/db/client";
import { deletePhotoFiles, photoFileExists } from "@/lib/photos";

// "Undo last change". Every change you make to cars (add, relist, merge,
// link, edit, prices, flags — from the UI or the API) runs through withUndo,
// which saves the affected cars' rows exactly as they were beforehand, in
// the same transaction as the change itself. Undoing puts those rows back:
// the cars, their price and listing history, their photos, and every car's
// "also listed at" group. Changes are undone newest first; only the last
// KEEP are remembered.
//
// Undo restores whole cars, so it also takes back anything that happened to
// those cars after the change — a price a scan logged since, say. Scans and
// other automatic updates aren't changes you can undo themselves.

const KEEP = 20;

type Row = Record<string, string | number | null>;

type Snapshot = {
  cars: Row[];
  prices: Row[];
  listings: Row[];
  photos: Row[];
  // Every grouped car's group_id, not just the affected ones' — linking or
  // merging can repoint other members of a group too.
  groups: { id: string; group_id: string }[];
};

export type UndoEntry = { id: string; label: string; created_at: string };

// node:sqlite rows have a null prototype — copied into plain objects so they
// serialize like any other.
const plain = <T>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) }) as T);
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

function takeSnapshot(db: DatabaseSync, carIds: string[]): Snapshot {
  const ids = placeholders(carIds.length);
  const rows = (table: string, column: string) =>
    plain<Row>(db.prepare(`select * from ${table} where ${column} in (${ids})`).all(...carIds));
  return {
    cars: rows("cars", "id"),
    prices: rows("price_history", "car_id"),
    listings: rows("listing_history", "car_id"),
    photos: rows("car_photos", "car_id"),
    groups: plain(db.prepare("select id, group_id from cars where group_id is not null").all()),
  };
}

function insertRows(db: DatabaseSync, table: string, rows: Row[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`insert into ${table} (${columns.join(", ")}) values (${placeholders(columns.length)})`).run(
      ...columns.map((c) => row[c])
    );
  }
}

// "2023 BMW 540i M Sport", for undo labels.
export function carLabel(db: DatabaseSync, carId: string): string {
  const car = db.prepare("select year, make, model from cars where id = ?").get(carId) as
    | { year: number; make: string; model: string }
    | undefined;
  return car ? `${car.year} ${car.make} ${car.model}` : "a car";
}

// Runs `fn` in a transaction and records it as undoable. `carIds` must cover
// every car `fn` touches, including one it's about to create (it has no
// rows yet, so undoing deletes it). `label` is what the undo button shows,
// e.g. "Added a new listing to 2023 BMW 540i M Sport".
export function withUndo<T>(db: DatabaseSync, label: string, carIds: string[], fn: () => T): T {
  const ids = Array.from(new Set(carIds.filter(Boolean)));
  return withTransaction(db, () => {
    const before = takeSnapshot(db, ids);
    const result = fn();
    db.prepare("insert into undo_log (id, label, car_ids, snapshot) values (?, ?, ?, ?)").run(
      randomUUID(),
      label,
      JSON.stringify(ids),
      JSON.stringify(before)
    );
    db.prepare(
      `delete from undo_log where rowid not in (select rowid from undo_log order by rowid desc limit ${KEEP})`
    ).run();
    return result;
  });
}

export function getLastUndo(): UndoEntry | null {
  const row = getDb().prepare("select id, label, created_at from undo_log order by rowid desc limit 1").get();
  return row ? ({ ...row } as UndoEntry) : null;
}

// Undoes the most recent change. Pass the id the user saw on the button, so
// a click can't undo something newer than what it said (another tab, the
// app, a second click).
export async function undoLastChange(
  expectedId?: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const db = getDb();
  let label = "";
  let filesToDelete: string[] = [];
  try {
    withTransaction(db, () => {
      const entry = db
        .prepare("select id, label, car_ids, snapshot from undo_log order by rowid desc limit 1")
        .get() as { id: string; label: string; car_ids: string; snapshot: string } | undefined;
      if (!entry) throw new Error("There's nothing to undo.");
      if (expectedId && entry.id !== expectedId) {
        throw new Error("Something else changed since — reload to see the latest change to undo.");
      }
      label = entry.label;
      const carIds = JSON.parse(entry.car_ids) as string[];
      const snapshot = JSON.parse(entry.snapshot) as Snapshot;
      const ids = placeholders(carIds.length);

      // Photos saved since (e.g. downloaded for a car being un-added) go with
      // their rows; the snapshot's own files are kept.
      const keptFiles = new Set(snapshot.photos.map((p) => p.file));
      filesToDelete = (
        db.prepare(`select file from car_photos where car_id in (${ids})`).all(...carIds) as { file: string }[]
      )
        .map((p) => p.file)
        .filter((file) => !keptFiles.has(file));

      // Groups are put back wholesale below; clearing them first also frees
      // the affected cars from other cars' group_id references.
      db.prepare("update cars set group_id = null where group_id is not null").run();
      db.prepare(`delete from cars where id in (${ids})`).run(...carIds); // cascades to their history and photos

      insertRows(
        db,
        "cars",
        snapshot.cars.map((c) => ({ ...c, group_id: null }))
      );
      insertRows(db, "price_history", snapshot.prices);
      insertRows(db, "listing_history", snapshot.listings);
      // A merge deletes the merged-away car's photo files when the kept car
      // has its own; those can't come back (the next check re-downloads).
      insertRows(
        db,
        "car_photos",
        snapshot.photos.filter((p) => photoFileExists(String(p.file)))
      );

      const setGroup = db.prepare(
        "update cars set group_id = ? where id = ? and exists (select 1 from cars where id = ?)"
      );
      for (const g of snapshot.groups) setGroup.run(g.group_id, g.id, g.group_id);

      db.prepare("delete from undo_log where id = ?").run(entry.id);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not undo.";
    return {
      ok: false,
      error: message.includes("UNIQUE constraint failed")
        ? "Can't undo: another car now has the listing URL this would restore."
        : message,
    };
  }
  await deletePhotoFiles(filesToDelete);
  return { ok: true, label };
}
