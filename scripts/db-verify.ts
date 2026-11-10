// Smoke-checks the database guards: RLS, storage bucket, activity-log trigger,
// append-only enforcement and counters. Writes happen in a rolled-back transaction.
// Usage: pnpm db:verify
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`,
  );
}
async function rejects(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

try {
  const noRls = await sql`
    select relname from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`;
  check(
    "RLS enabled on every public table",
    noRls.length === 0,
    noRls.map((r) => r.relname),
  );

  const [config] = await sql`select allowed_email from private.app_config where id = 1`;
  check("allowed email configured", Boolean(config?.allowed_email), config?.allowed_email);

  const [bucket] = await sql`select public from storage.buckets where id = 'documents'`;
  check("documents bucket exists and is private", bucket?.public === false);

  const [policies] = await sql`
    select count(*)::int as n from pg_policies
    where schemaname = 'storage' and policyname like 'documents:%'`;
  check("storage policies present", policies?.n === 4, policies?.n);

  const [anon] = await sql`
    select count(*)::int as n from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'`;
  check("anon has no table grants", anon?.n === 0, anon?.n);

  await sql
    .begin(async (tx) => {
      await tx`select set_config('app.actor', 'verify@example.test', true)`;
      const [vendor] = await tx`
        insert into vendors (name) values ('Verify') returning id`;
      await tx`update vendors set name = 'Verify 2' where id = ${vendor!.id}`;
      await tx`update vendors set updated_at = now() where id = ${vendor!.id}`;
      const log = await tx`
        select actor, action, module, record_label, changes from activity_log
        where record_id = ${vendor!.id} order by id`;
      check("insert + update logged; timestamp-only update skipped", log.length === 2);
      check("actor recorded from app.actor", log[0]?.actor === "verify@example.test");
      check(
        "update stores only changed fields as old → new",
        Object.keys(log[1]?.changes ?? {}).join() === "name" &&
          log[1]?.changes.name.old === "Verify" &&
          log[1]?.changes.name.new === "Verify 2",
        log[1]?.changes,
      );
      check("record label captured", log[0]?.record_label === "Verify");

      const [n] = await tx`
        select public.next_counter('VERIFY') as a, public.next_counter('VERIFY') as b`;
      check("next_counter increments", n?.a === 1 && n?.b === 2, n);

      const [po] = await tx`select count(*)::int as n from po_totals`;
      check("po_totals view queryable", typeof po?.n === "number");

      throw new Error("rollback");
    })
    .catch((error: Error) => {
      if (error.message !== "rollback") throw error;
    });

  check(
    "activity_log rejects UPDATE",
    await rejects(() => sql`update activity_log set actor = 'x'`),
  );
  check("activity_log rejects DELETE", await rejects(() => sql`delete from activity_log`));
  check("activity_log rejects TRUNCATE", await rejects(() => sql`truncate activity_log`));
} finally {
  await sql.end();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll database checks passed");
