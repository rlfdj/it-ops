// DESTRUCTIVE: removes every object this app's migrations created (tables, types,
// functions, the activity log, storage policies and uploaded files) so migrations and
// the seed can run again from scratch. Meant for sample data only.
//
// Usage: pnpm db:reset --yes   then   pnpm db:setup && pnpm db:seed --yes
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--yes")) {
  console.error(
    "This deletes ALL app data, including the activity log and uploaded files.\n" +
      "Run `pnpm db:backup` first if anything matters, then: pnpm db:reset --yes",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
const sql = postgres(url, { max: 1, onnotice: () => {} });

const TABLES = [
  "activity_log",
  "tasks",
  "checklist_items",
  "checklists",
  "subscription_invoices",
  "subscriptions",
  "stock_items",
  "asset_events",
  "assets",
  "documents",
  "po_lines",
  "purchase_orders",
  "people",
  "vendors",
  "entities",
  "id_counters",
];
const TYPES = [
  "entity_code",
  "person_status",
  "po_status",
  "asset_type",
  "asset_status",
  "asset_event_type",
  "doc_owner_type",
  "doc_kind",
  "sub_kind",
  "billing_cycle",
  "invoice_status",
  "task_status",
  "task_source",
  "checklist_kind",
  "checklist_status",
  "checklist_section",
  "log_action",
];
const FUNCTIONS = [
  "set_updated_at()",
  "is_allowed_user()",
  "log_activity()",
  "activity_log_append_only()",
  "next_counter(text)",
];
const STORAGE_POLICIES = [
  "documents: allowed user select",
  "documents: allowed user insert",
  "documents: allowed user update",
  "documents: allowed user delete",
];

try {
  // 1. Uploaded files (needs the storage API; paths come from the documents table).
  const [{ exists } = { exists: false }] = await sql<{ exists: boolean }[]>`
    select to_regclass('public.documents') is not null as exists`;
  if (exists) {
    const paths = (await sql<{ storage_path: string }[]>`select storage_path from documents`).map(
      (r) => r.storage_path,
    );
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (paths.length && supabaseUrl && key) {
      const storage = createClient(supabaseUrl, key, { auth: { persistSession: false } }).storage;
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await storage.from("documents").remove(paths.slice(i, i + 100));
        if (error) throw new Error(`Could not delete files: ${error.message}`);
      }
      console.log(`Deleted ${paths.length} files from the documents bucket.`);
    } else if (paths.length) {
      console.warn("Skipped file deletion: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
    }
  }

  // 2. Database objects.
  await sql.begin(async (tx) => {
    await tx`drop view if exists public.po_totals`;
    for (const t of TABLES) await tx`drop table if exists ${tx("public")}.${tx(t)} cascade`;
    for (const t of TYPES) await tx`drop type if exists ${tx("public")}.${tx(t)} cascade`;
    for (const f of FUNCTIONS) await tx.unsafe(`drop function if exists public.${f} cascade`);
    for (const p of STORAGE_POLICIES) await tx`drop policy if exists ${tx(p)} on storage.objects`;
    await tx`drop schema if exists private cascade`;
    await tx`drop schema if exists drizzle cascade`;
  });
  console.log("Database reset. Next: pnpm db:setup && pnpm db:seed --yes");
} finally {
  await sql.end();
}
