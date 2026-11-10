import { sql } from "drizzle-orm";
import type { Tx } from "./actor.ts";
import { formatPoNumber, poNumberScope } from "../lib/ids.ts";
import { yearIn } from "../lib/dates.ts";
import { getTimeZoneTx } from "../server/settings.ts";

async function nextCounter(tx: Tx, scope: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`select public.next_counter(${scope}) as n`);
  const n = rows[0]?.n;
  if (typeof n !== "number") throw new Error(`next_counter(${scope}) returned nothing`);
  return n;
}

/** Claims the next PO number for the current year in the workspace time zone, e.g. `PO-2026-0159`. */
export async function nextPoNumber(tx: Tx, now: Date = new Date()): Promise<string> {
  const year = yearIn(await getTimeZoneTx(tx), now);
  return formatPoNumber(year, await nextCounter(tx, poNumberScope(year)));
}
