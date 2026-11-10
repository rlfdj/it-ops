// Activity log retention: entries older than two years are deleted (owner rule).
// The database enforces it (prune_activity_log() and the append-only trigger, migration
// 0017/0018 "activity_log_retention"); this only decides when to ask for it.

import { sql } from "drizzle-orm";
import type { AppDb } from "../db/actor.ts";

const EVERY_MS = 6 * 60 * 60 * 1000;
let lastRun = 0;

/**
 * Deletes log entries older than two years, at most once every six hours per server
 * instance (it is called from the dashboard load; the delete uses the `at` index, so it
 * costs next to nothing when there is nothing to remove). Returns the rows removed, or
 * null when skipped.
 */
export async function pruneActivityLog(db: AppDb, now = Date.now()): Promise<number | null> {
  if (now - lastRun < EVERY_MS) return null;
  lastRun = now;
  const rows = await db.execute<{ removed: number }>(
    sql`select public.prune_activity_log() as removed`,
  );
  return Number(rows[0]?.removed ?? 0);
}
