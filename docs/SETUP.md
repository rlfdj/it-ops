# Setting up IT Ops (Supabase + Vercel)

This guide takes you from a fork of this repository to your own live copy of IT Ops, installed as an app on your computer and phone. It takes about 30–45 minutes. Everything used here has a free plan.

You will end up with:

- **Supabase**: your database, sign-in and file storage.
- **Vercel**: hosts the website at an address like `https://your-it-ops.vercel.app`.
- **The installed app**: the same website opened in its own window, with its own icon.

Only one email address can ever sign in: the one you choose in step 3.

---

## 1. What you need

- Accounts (free): [GitHub](https://github.com), [Supabase](https://supabase.com), [Vercel](https://vercel.com). Sign up to Vercel with your GitHub account; it makes step 6 easier.
- On your computer:
  - [Node.js](https://nodejs.org) 22 or newer (the LTS download is fine).
  - [Git](https://git-scm.com/downloads).
  - pnpm: after installing Node, run `npm install -g pnpm` in a terminal.

Check them:

```bash
node -v      # v22 or higher
git --version
pnpm -v
```

## 2. Fork and download the code

1. On the repository page on GitHub, click **Fork**, then **Create fork**. You now have your own copy under your account.
2. Download it to your computer (replace `YOUR-USERNAME`):

   ```bash
   git clone https://github.com/YOUR-USERNAME/it-ops.git
   cd it-ops
   pnpm install
   ```

## 3. Create the Supabase project

1. In Supabase, click **New project**.
   - **Name**: anything, for example `it-ops`.
   - **Database password**: click **Generate**, then **copy it somewhere safe**. You need it in a moment and Supabase won't show it again.
   - **Region**: pick the one closest to you. Remember it; the website should run in the same area (step 6).
2. Wait for the project to finish setting up (a minute or two).
3. Collect four values:

   | What                       | Where in Supabase                                                                                                                         |
   | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | Database connection string | Click **Connect** (top of the project page) → **Session pooler** → copy the URI. Replace `[YOUR-PASSWORD]` with the password from step 1. |
   | Project URL                | **Project Settings → Data API** (or the **Connect** dialog) → `https://xxxx.supabase.co`                                                  |
   | Publishable key            | **Project Settings → API Keys** → `sb_publishable_…`                                                                                      |
   | Secret key                 | **Project Settings → API Keys** → `sb_secret_…` (click to reveal). Treat it like a password.                                              |

   > Use the **Session pooler** string (it contains `pooler.supabase.com` and port `5432`). The "Direct connection" string does not work from Vercel, and the "Transaction pooler" (port `6543`) does not work with this app.

## 4. Configure and set up the database

1. In the `it-ops` folder, copy the example settings file:

   ```bash
   cp .env.example .env.local
   ```

   (On Windows PowerShell: `Copy-Item .env.example .env.local`.)

2. Open `.env.local` in a text editor and fill it in:

   ```bash
   DATABASE_URL=postgresql://postgres.xxxx:YOUR-PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   ALLOWED_EMAIL=you@yourdomain.com
   ```

   `ALLOWED_EMAIL` is the only address that will be able to sign in. `.env.local` is never uploaded to GitHub; keep it private.

3. Create the tables, security rules and file storage:

   ```bash
   pnpm db:setup     # applies all migrations, then stores ALLOWED_EMAIL in the database
   pnpm db:verify    # optional: checks the security rules and storage are in place
   ```

   If you ever change `ALLOWED_EMAIL`, run `pnpm db:config` again (and update it in Vercel too).

## 5. Try it on your computer (optional but recommended)

1. In Supabase go to **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` (you'll change this in step 7).
   - **Redirect URLs** → **Add URL**: `http://localhost:3000/auth/callback`
2. Start the app:

   ```bash
   pnpm dev
   ```

3. Open <http://localhost:3000>, enter your `ALLOWED_EMAIL`, and click the link in the email. You're in.

Stop it with `Ctrl+C` when you're done.

Optional: `pnpm db:seed --yes` fills an **empty** database with sample data to look around. Don't run it once you've entered real data.

## 6. Put it online with Vercel

1. **Match the region.** Open `vercel.json` in the project. It says `"regions": ["fra1"]` (Frankfurt). Change it to the Vercel region nearest your Supabase region, so the site and database are close together:

   | Supabase region                    | Vercel region |
   | ---------------------------------- | ------------- |
   | Frankfurt (eu-central-1)           | `fra1`        |
   | London (eu-west-2)                 | `lhr1`        |
   | Ireland (eu-west-1)                | `dub1`        |
   | N. Virginia (us-east-1)            | `iad1`        |
   | Oregon / N. California (us-west-…) | `sfo1`        |
   | Mumbai (ap-south-1)                | `bom1`        |
   | Singapore (ap-southeast-1)         | `sin1`        |
   | Sydney (ap-southeast-2)            | `syd1`        |

   Save, then upload the change:

   ```bash
   git commit -am "Set Vercel region"
   git push
   ```

2. In Vercel, click **Add New… → Project**, find your `it-ops` fork and click **Import**.
3. Before deploying, open **Environment Variables** and add the same five values from your `.env.local`: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ALLOWED_EMAIL`. (Tip: you can paste the whole `.env.local` contents into the first field and Vercel splits them.)
4. Click **Deploy** and wait for it to finish (2–3 minutes).
5. Note your address, shown under **Domains** (for example `https://it-ops-yourname.vercel.app`). You can rename it under **Settings → Domains**.

> If you add or change an environment variable later, go to **Deployments → ⋯ → Redeploy** for it to take effect.

## 7. Let the live site sign you in

Back in Supabase, **Authentication → URL Configuration**:

- **Site URL**: your Vercel address, e.g. `https://it-ops-yourname.vercel.app`
- **Redirect URLs** → **Add URL**: `https://it-ops-yourname.vercel.app/auth/callback`
  (keep the localhost one if you want to keep running it on your computer)

Now open your Vercel address, enter your email, and click the link in the email. Open the link on the **same device and browser** where you asked for it.

## 8. First things to set

In the app, open **Settings**:

- **Workspace name and logo**.
- **Currency and time zone**: these start as AED and Asia/Dubai; change them to yours. Each subscription can also have its own currency.
- **Checklist templates**: the accounts to set up when someone joins and to disable when someone leaves. Every new on/offboarding checklist starts from these. "Issue equipment" / "Collect equipment" is always the first step.

## 9. Install it as an app

IT Ops is a web app you can install: it gets its own icon and window, without browser tabs or address bar. It always shows live data, so it needs an internet connection.

Sign in first in the browser, then install:

- **Chrome (Windows, Mac, Linux)**: click the install icon at the right end of the address bar (a screen with a down arrow), or **⋮ → Cast, save and share → Install page as app**.
- **Edge**: **⋯ → Apps → Install this site as an app**.
- **Safari on Mac**: **File → Add to Dock**.
- **Android (Chrome)**: **⋮ → Add to Home screen → Install**.
- **iPhone / iPad (Safari)**: tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**.

On iPhone, the home-screen app keeps its own sign-in separate from Safari. If it shows the sign-in page, sign in in Safari, then remove the home-screen icon and add it again from Safari.

To uninstall, remove it like any other app.

## 10. Keeping it running

- **Updates**: when you change the code, `git push` and Vercel redeploys automatically. If the change adds files under `drizzle/`, also run `pnpm db:migrate` from your computer. Never run migrations from Vercel.
- **Backups**: `pnpm db:backup` saves your data and uploaded files to a folder on your computer; `pnpm db:restore <folder>` puts them back. Do this now and then.
- **Free plan limits**:
  - Supabase pauses a free project after about a week with no activity. Open the Supabase dashboard and click **Restore** if that happens; your data is kept.
  - Supabase's built-in email only sends a few sign-in emails per hour. If you need more, set up your own email sender under **Authentication → Emails → SMTP Settings**.
- `pnpm db:reset --yes` **deletes everything**. Only use it if you really want to start over.

## Troubleshooting

| Problem                                                                                | Fix                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This address can't sign in"                                                           | The email must exactly match `ALLOWED_EMAIL` in Vercel. After changing it, redeploy and run `pnpm db:config`.                                                                                                                                                              |
| The email link opens a page that says the link is invalid or sends you back to sign-in | Add `https://<your-site>/auth/callback` to Supabase **Redirect URLs**, and open the link in the same browser you requested it from. Links expire after one use.                                                                                                            |
| The email link goes to `localhost`                                                     | Change **Site URL** in Supabase to your Vercel address.                                                                                                                                                                                                                    |
| "Too many sign-in emails"                                                              | Wait a few minutes (Supabase's free email limit), or set up your own SMTP.                                                                                                                                                                                                 |
| Signed in but pages are empty or saving fails                                          | Run `pnpm db:config` (it tells the database which email is allowed), then `pnpm db:verify`.                                                                                                                                                                                |
| `pnpm db:setup` can't connect                                                          | Check `DATABASE_URL`: it must be the **Session pooler** string with your real password, and the project must not be paused. If the password contains symbols like `@` or `#`, reset it in Supabase (**Project Settings → Database**) to one with letters and numbers only. |
| Vercel build fails with a missing variable                                             | Add all five environment variables in Vercel, then redeploy.                                                                                                                                                                                                               |
| No install option in the browser                                                       | Make sure you're on the `https://` Vercel address (not a preview link), then reload the page.                                                                                                                                                                              |
