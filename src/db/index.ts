import "server-only";
import { cache } from "react";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { runWithActor, type AppDb, type Tx } from "./actor";

export type { AppDb as Db, Tx };
export { SYSTEM_ACTOR } from "./actor";

// Both locally and on Vercel this connects through Supabase's session pooler (port 5432),
// which allows 15 clients in total. (The transaction pooler, 6543, cannot be used: it does
// not keep a postgres.js transaction on one server connection, which withActor relies on.)
// So each process keeps a small pool and releases idle connections quickly.
const options = {
  max: process.env.VERCEL ? 2 : 3,
  fetch_types: false,
  prepare: true,
  idle_timeout: 10,
  max_lifetime: 60 * 5,
} as const;

// One pool per server process, shared across requests (and hot reloads locally). Vercel's
// Fluid compute reuses a function instance for many requests, so the pool is reused too.
const globalForDb = globalThis as typeof globalThis & { __itopsDb?: AppDb };

/** Returns the Drizzle client (React `cache` dedupes the lookup within one render). */
export const getDb = cache((): AppDb => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  globalForDb.__itopsDb ??= drizzle(postgres(url, options), { schema, casing: "snake_case" });
  return globalForDb.__itopsDb;
});

/**
 * Runs `fn` in a transaction attributed to `actor` (the signed-in email or
 * `SYSTEM_ACTOR`). All writes go through this so the activity log knows who
 * made each change.
 */
export function withActor<T>(actor: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithActor(getDb(), actor, fn);
}
