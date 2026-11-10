// Test helpers for *.db.test.ts: a real database connection and rolled-back transactions.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.ts";
import type { Tx } from "../db/actor.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set; db tests need a database.");

export const client = postgres(url, { max: 2, onnotice: () => {} });
export const db = drizzle(client, { schema, casing: "snake_case" });

export const TEST_ACTOR = "test@example.test";

class Rollback extends Error {}

/** Runs `fn` as TEST_ACTOR in a transaction that is always rolled back. */
export async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.actor', ${TEST_ACTOR}, true)`);
      await fn(tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}
