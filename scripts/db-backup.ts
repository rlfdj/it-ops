// Saves a copy of all app data to backups/<timestamp>/ on this machine:
//   tables/<table>.json   every row of every app table (including the activity log)
//   files/<path>          every uploaded document from the private storage bucket
// The free Supabase plan has no automatic backups, so run this regularly.
// Usage: pnpm db:backup [--no-files]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "vendors",
  "people",
  "purchase_orders",
  "po_lines",
  "documents",
  "stock_items",
  "subscriptions",
  "subscription_invoices",
  "checklists",
  "checklist_items",
  "tasks",
  "id_counters",
  "activity_log",
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
const withFiles = !process.argv.includes("--no-files");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const root = join("backups", stamp);
const sql = postgres(url, { max: 1 });

try {
  await mkdir(join(root, "tables"), { recursive: true });
  const summary: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await sql`select * from ${sql(table)}`;
    await writeFile(join(root, "tables", `${table}.json`), JSON.stringify(rows, null, 2));
    summary[table] = rows.length;
  }
  console.table(summary);

  if (withFiles) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !key)
      throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, or pass --no-files.");
    const storage = createClient(supabaseUrl, key, {
      auth: { persistSession: false },
    }).storage.from("documents");
    const docs = await sql<
      { storage_path: string }[]
    >`select storage_path from documents order by storage_path`;
    let saved = 0;
    for (const { storage_path } of docs) {
      const { data, error } = await storage.download(storage_path);
      if (error || !data) {
        console.warn(`Could not download ${storage_path}: ${error?.message ?? "no data"}`);
        continue;
      }
      const target = join(root, "files", ...storage_path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, new Uint8Array(await data.arrayBuffer()));
      saved++;
    }
    console.log(`Downloaded ${saved} of ${docs.length} files.`);
  }
  console.log(`Backup written to ${root}`);
} finally {
  await sql.end();
}
