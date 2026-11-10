// One-off: replaces the sample on/offboarding checklists (old Accounts/Assets/Licences/SIM
// layout) with ones built on the current templates. Only touches the three sample people's
// checklists and refuses to run if any other checklist exists.
//
// Usage: node --env-file=.env.local scripts/replace-sample-checklists.ts --yes
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema.ts";
import { insertSampleChecklists } from "./sample-checklists.ts";

if (!process.argv.includes("--yes")) {
  console.error(
    "Replaces the sample checklists for Karim Saleh, Priya Nair and Aisha Rahman. Run with --yes.",
  );
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

const SAMPLE = { karim: "Karim Saleh", priya: "Priya Nair", aisha: "Aisha Rahman" } as const;
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s, casing: "snake_case" });

try {
  const result = await db.transaction(async (tx) => {
    // Sample data: don't fill the activity log with the swap.
    await tx.execute(sql`select set_config('app.skip_activity_log', 'on', true)`);
    const persons = await tx
      .select({ id: s.people.id, name: s.people.fullName })
      .from(s.people)
      .where(inArray(s.people.fullName, Object.values(SAMPLE)));
    const byName = new Map(persons.map((p) => [p.name, p]));
    const sampleIds = new Set(persons.map((p) => p.id));

    const existing = await tx.select({ personId: s.checklists.personId }).from(s.checklists);
    const foreign = existing.filter((c) => !sampleIds.has(c.personId));
    if (foreign.length) {
      throw new Error(
        `Found ${foreign.length} checklist(s) for other people — not touching anything.`,
      );
    }

    // Deleting the checklists cascades to their items and the linked tasks.
    const removed = await tx.delete(s.checklists).returning({ id: s.checklists.id });
    const people = new Map(
      Object.entries(SAMPLE).map(([key, name]) => {
        const p = byName.get(name);
        if (!p) throw new Error(`Sample person ${name} not found.`);
        return [key, p];
      }),
    );
    const counts = await insertSampleChecklists(tx, people);
    return { removed: removed.length, ...counts };
  });
  console.table(result);
} finally {
  await client.end();
}
