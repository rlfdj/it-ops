import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.ts";

type Schema = typeof schema;
export type AppDb = PostgresJsDatabase<Schema>;
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/** Actor recorded for automatic writes (period roll-over, generated tasks). */
export const SYSTEM_ACTOR = "system";

/**
 * Runs `fn` in a transaction with `app.actor` set, so the activity-log trigger
 * records who made each change. Every write in the app goes through this.
 */
export function runWithActor<T>(db: AppDb, actor: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor', ${actor}, true)`);
    return fn(tx);
  });
}
