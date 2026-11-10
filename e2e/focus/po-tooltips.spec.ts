import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signIn } from "./sign-in";

// Read-only: the View / Change / Download icon buttons of a purchase's document slot show
// their tooltip on keyboard focus.
test("procurement document icon tooltips open on focus", async ({ page }) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const { data: doc } = await db
    .from("documents")
    .select("owner_id, kind")
    .eq("owner_type", "purchase_order")
    .in("kind", ["approval", "invoice", "delivery_note"])
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
  const panel = page.getByRole("complementary", { name: `Purchase ${po!.po_number}` });
  const kind = { approval: "approval", invoice: "invoice", delivery_note: "delivery note" }[
    doc!.kind as "approval"
  ];
  for (const [name, role, text] of [
    [new RegExp(`^View ${kind}`), "link", "View"],
    [new RegExp(`^Change ${kind}`), "button", "Change"],
    [new RegExp(`^Download ${kind}`), "link", "Download"],
  ] as const) {
    await panel.getByRole(role, { name }).focus();
    await expect(page.getByRole("tooltip").filter({ hasText: text }).first()).toBeVisible();
  }
});
