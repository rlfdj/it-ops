// Writes ALLOWED_EMAIL into private.app_config, which the RLS policies read.
// Usage: pnpm db:config   (runs after migrations in `pnpm db:setup`)
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const email = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
if (!email || !email.includes("@"))
  throw new Error("ALLOWED_EMAIL is not set to an email address.");

const sql = postgres(url, { max: 1 });
try {
  await sql`
    insert into private.app_config (id, allowed_email) values (1, ${email})
    on conflict (id) do update set allowed_email = excluded.allowed_email`;
  console.log(`Allowed user set to ${email}`);
} finally {
  await sql.end();
}
