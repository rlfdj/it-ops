import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Smoke test: signs in through the real magic-link callback (a one-time token minted with
 * the Supabase secret key, so no email is sent) and opens every screen.
 */
async function signIn(page: Page) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const email = process.env.ALLOWED_EMAIL;
  if (!url || !secret || !email)
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and ALLOWED_EMAIL");
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  await page.goto(`/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink`);
  await expect(page).toHaveURL(/\/$/);
}

const SCREENS: { path: string; heading: RegExp }[] = [
  { path: "/", heading: /^Good (morning|afternoon|evening)/ },
  { path: "/procurement", heading: /^Procurement$/ },
  { path: "/stock", heading: /^Stock$/ },
  { path: "/subscriptions", heading: /^Subscriptions$/ },
  { path: "/tasks", heading: /^Tasks$/ },
  { path: "/onboarding", heading: /./ },
  { path: "/board", heading: /^Board$/ },
  { path: "/activity", heading: /^Activity log$/ },
  { path: "/settings", heading: /^Settings$/ },
];

test("signs in and opens every screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await signIn(page);
  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.path).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 }), screen.path).toHaveText(screen.heading);
    // No horizontal page scroll; wide tables scroll inside their own container.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen.path} scrolls sideways`).toBeLessThanOrEqual(1);
  }

  for (const path of [
    "/procurement/export",
    "/stock/export",
    "/subscriptions/export",
    "/tasks/export",
    "/activity/export?range=all",
  ]) {
    const csv = await page.request.get(path, { maxRedirects: 0 });
    expect(csv.status(), path).toBe(200);
    expect(csv.headers()["content-type"], path).toContain("text/csv");
  }

  await page.goto("/procurement?po=PO-1999-0001");
  // On a phone the missing-PO notice opens as a sheet, which hides the page behind it from assistive tech.
  await expect(page.getByRole("heading", { level: 1, includeHidden: true })).toHaveText(
    /^Procurement$/,
  );

  expect(errors).toEqual([]);
});

test("signed-out visitors are sent to the login page", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/procurement");
  await expect(page).toHaveURL(/\/login/);
  await page.close();
});
