import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Signs in through the real magic-link callback with a one-time token minted with the
 * Supabase secret key (no email is sent). Only one token is valid at a time, so never run
 * two Playwright runs at once.
 */
export async function signIn(page: Page) {
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
