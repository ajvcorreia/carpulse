import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "@/lib/db/client";

// Daily copies of the database, kept next to it (same Docker volume) — a
// way back from a mistake that undo can't reach, or a bad day of scans.
// lib/scheduler.ts makes one each day; Settings can make one on demand and
// download any of them. The listing photos aren't included (they're files,
// not in the database) — a restored database still points at the same
// photo files, which stay where they are.

// Same reasoning as DB_PATH in lib/db/client.ts: statically scoped to
// <cwd>/data so build-time file tracing doesn't sweep in the whole project.
const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), "data", "backups");
const KEEP = 14;
const NAME = /^carpulse-(\d{4}-\d{2}-\d{2})\.db$/;

export type BackupFile = { name: string; date: string; size: number; created_at: string };

export function listBackups(): BackupFile[] {
  let names: string[];
  try {
    names = readdirSync(/* turbopackIgnore: true */ BACKUP_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => NAME.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const stat = statSync(/* turbopackIgnore: true */ join(BACKUP_DIR, name));
      return { name, date: NAME.exec(name)![1], size: stat.size, created_at: stat.mtime.toISOString() };
    });
}

export function hasBackupFor(date: string) {
  return existsSync(/* turbopackIgnore: true */ join(BACKUP_DIR, `carpulse-${date}.db`));
}

// Writes the backup for `date` (local, "YYYY-MM-DD"), replacing one already
// made that day, then drops all but the newest KEEP. VACUUM INTO gives a
// consistent, compacted copy even while the app is writing.
export function createBackup(date: string): BackupFile {
  mkdirSync(/* turbopackIgnore: true */ BACKUP_DIR, { recursive: true });
  const name = `carpulse-${date}.db`;
  const path = join(BACKUP_DIR, name);
  const tmp = `${path}.tmp`;
  rmSync(/* turbopackIgnore: true */ tmp, { force: true });
  getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  // Swapped in whole, so a half-written copy never looks like a backup.
  renameSync(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ path);

  const all = listBackups();
  for (const old of all.slice(KEEP)) rmSync(/* turbopackIgnore: true */ join(BACKUP_DIR, old.name), { force: true });
  return all.find((b) => b.name === name)!;
}

// A backup as a file download (404 for an unknown name).
export async function backupDownload(name: string): Promise<Response> {
  const path = backupFilePath(name);
  if (!path) return new Response("Backup not found.", { status: 404 });
  return new Response(new Uint8Array(await readFile(/* turbopackIgnore: true */ path)), {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

// The file behind a backup name, or null — only names this module makes,
// so a request can't reach anything else on disk.
export function backupFilePath(name: string): string | null {
  if (!NAME.test(name)) return null;
  const path = join(BACKUP_DIR, name);
  return existsSync(/* turbopackIgnore: true */ path) ? path : null;
}
