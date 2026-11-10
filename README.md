# IT Ops

A single-user IT operations app: procurement (status and documents), a simple stock list of what is in the IT store, subscriptions and contracts (with optional Standard / Premium seat rosters), on/offboarding checklists, tasks, a board and an activity log.

Sign-in is by magic link and is restricted to one address, `ALLOWED_EMAIL`.

## Stack

- Next.js (App Router, Server Components, Server Actions), TypeScript
- Supabase: Postgres, Auth and Storage
- Drizzle ORM and drizzle-kit (migrations in `drizzle/`)
- Tailwind CSS, shadcn/ui, TanStack Table, cmdk, Zod
- Vitest (unit and database tests) and Playwright (end-to-end)

## Setup

New here? Follow the step-by-step guide in [docs/SETUP.md](docs/SETUP.md): Supabase, Vercel and installing it as an app.

Requirements: Node 22+ and pnpm 10+.

1. Create a Supabase project. Under Project Settings, copy the Postgres connection string (use the **session pooler**, port 5432), the project URL, the publishable key and the secret key.
2. Copy `.env.example` to `.env.local` and fill in the values. Set `ALLOWED_EMAIL` to the address that may sign in.
3. In Supabase Auth settings, add your site URL (for example `http://localhost:3000`) and `<site URL>/auth/callback` as allowed redirect URLs.
4. Install and migrate:

   ```bash
   pnpm install
   pnpm db:migrate     # creates the tables, triggers, RLS policies and the private "documents" storage bucket
   pnpm db:config      # stores ALLOWED_EMAIL for the RLS policies (re-run after changing it)
   pnpm dev            # http://localhost:3000
   ```

   `pnpm db:setup` runs `db:migrate` and `db:config` together.

Optional: `pnpm db:seed --dry-run` previews the sample data and `pnpm db:seed --yes` inserts it into an empty database.

## Environment variables

| Variable                               | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                         | Postgres connection string (Supabase session pooler) |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL (inlined at build time)         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (inlined at build time)     |
| `SUPABASE_SECRET_KEY`                  | Server-only key for setup scripts and storage access |
| `ALLOWED_EMAIL`                        | The only address allowed to sign in                  |

## Scripts

| Script                                     | What it does                                            |
| ------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev` / `build` / `start`             | Next.js                                                 |
| `pnpm lint` / `typecheck` / `format:check` | ESLint, `tsc --noEmit`, Prettier                        |
| `pnpm test`                                | Unit tests (Vitest)                                     |
| `pnpm test:db`                             | Database tests against `DATABASE_URL` (each rolls back) |
| `pnpm test:e2e`                            | Playwright smoke test                                   |
| `pnpm db:generate`                         | Generate a migration from `src/db/schema.ts`            |
| `pnpm db:migrate`                          | Apply pending migrations                                |
| `pnpm db:verify`                           | Check RLS, storage and activity-log guards              |
| `pnpm db:backup` / `db:restore <dir>`      | Back up / restore tables and uploaded files             |
| `pnpm db:reset --yes`                      | Destructive: drop all app tables and files              |

## Deploying (Vercel)

1. Import the repository in Vercel.
2. Add the five environment variables above (use the session pooler URL for `DATABASE_URL`).
3. Add the deployed URL and `<deployed URL>/auth/callback` to the Supabase Auth redirect URLs.
4. Run migrations from your own machine (`pnpm db:migrate`), never from the deployed app.

## Notes

Amounts default to AED and the time zone to Asia/Dubai; both can be changed in Settings. The logo and workspace name can also be changed there.
