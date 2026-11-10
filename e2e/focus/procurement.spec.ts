import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signIn } from "./sign-in";

// Focused check of purchase file names: project and invoice number (see document-names.ts).
// Uses a read-only path: an existing purchase's documents list and its download names.
test("procurement document names follow the convention", async ({ page }) => {
  // A purchase that has a document attached (read only; nothing is changed).
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const { data: doc } = await db
    .from("documents")
    .select("owner_id")
    .eq("owner_type", "purchase_order")
    .limit(1)
    .maybeSingle();
  test.skip(!doc, "no purchase has a document yet");
  const { data: po } = await db
    .from("purchase_orders")
    .select("po_number")
    .eq("id", doc!.owner_id)
    .single();
  await signIn(page);
  await page.goto(`/procurement?po=${po!.po_number}`);
  await page.waitForLoadState("networkidle");
  const view = page.getByRole("link", { name: /^View / }).first();
  await expect(view).toBeVisible();
  const href = (await view.getAttribute("href"))!;
  const res = await page.request.get(`${href}?download`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(res.status());
  // /documents/{id}/<Vendor_[Project_]Type_YYYY-MM-DD>.ext?download
  expect(res.headers()["location"] ?? "").toMatch(
    /\/documents\/[0-9a-f-]{36}\/[A-Za-z0-9-]+(_[A-Za-z0-9-]+)*_(Invoice|Delivery-Note|Approval)_\d{4}-\d{2}-\d{2}\.\w+\?download$/,
  );
  const saved = await page.request.get(`${href}?download`);
  expect(saved.headers()["content-disposition"] ?? "").toMatch(/^attachment;/);
});
