// Restores a `pnpm db:backup` folder into an EMPTY database (run `pnpm db:setup` first):
//   tables/<table>.json   rows inserted as-is (ids, timestamps and the activity log kept)
//   files/<path>          uploaded documents put back in the private storage bucket
// Used to move to another Supabase project or region. Refuses to touch a database that
// already has data. Sign-in users are not part of the backup: sign in again afterwards.
// Usage: pnpm db:restore backups/<timestamp> --yes [--no-files]
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

// Parents before children, so every foreign key already resolves.
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

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir) throw new Error("Usage: pnpm db:restore backups/<timestamp> --yes [--no-files]");
if (!process.argv.includes("--yes")) throw new Error("Add --yes to restore into DATABASE_URL.");
const withFiles = !process.argv.includes("--no-files");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
console.log(`Restoring ${dir} into ${new URL(url).host}`);

const sql = postgres(url, { max: 1 });

async function* walk(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

try {
  for (const table of TABLES) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
    const n = row?.n ?? 0;
    if (n > 0) throw new Error(`${table} already has ${n} rows: restore needs an empty database.`);
  }

  const summary: Record<string, number> = {};
  await sql.begin(async (tx) => {
    // Restored rows are history, not new changes: keep the log triggers quiet.
    await tx`select set_config('app.skip_activity_log', 'on', true)`;
    for (const table of TABLES) {
      const rows = JSON.parse(await readFile(join(dir, "tables", `${table}.json`), "utf8"));
      if (rows.length) {
        await tx.unsafe(
          `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, $1::text::jsonb)`,
          [JSON.stringify(rows)],
        );
      }
      summary[table] = rows.length;
    }
    await tx`select setval(pg_get_serial_sequence('public.activity_log', 'id'), coalesce(max(id), 1)) from activity_log`;
  });
  console.table(summary);

  if (withFiles) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !key)
      throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, or pass --no-files.");
    const storage = createClient(supabaseUrl, key, {
      auth: { persistSession: false },
    }).storage.from("documents");
    const filesRoot = join(dir, "files");
    let uploaded = 0;
    let total = 0;
    for await (const file of walk(filesRoot)) {
      total++;
      const path = relative(filesRoot, file).split(sep).join("/");
      const { error } = await storage.upload(path, await readFile(file), {
        contentType: MIME[extname(file).toLowerCase()] ?? "application/pdf",
        upsert: true,
      });
      if (error) console.warn(`Could not upload ${path}: ${error.message}`);
      else uploaded++;
    }
    console.log(`Uploaded ${uploaded} of ${total} files.`);
  }
  console.log("Restore complete. Run pnpm db:verify next.");
} finally {
  await sql.end();
}
