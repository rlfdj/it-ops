import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Purchase discount, 5% VAT and the invoice date (asked for with the invoice file), shared by the focused spec
 * (e2e/focus/po-totals.spec.ts) and the full suite (e2e/workflows.spec.ts). Creates one
 * E2E purchase through the dialog, checks the live and saved totals and the invoice file
 * name, then removes only what it made (by its exact E2E vendor).
 */
const ex = expect.configure({ timeout: 15_000 });

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ),
});

/** Removes the purchase(s) of this exact E2E vendor, their documents and files, and the vendor. */
async function cleanUp(vendorName: string) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  if (!vendorName.startsWith("E2E")) throw new Error("Refusing to clean a non-E2E vendor");
  const { data: vendors } = await db.from("vendors").select("id").eq("name", vendorName);
  for (const v of vendors ?? []) {
    const { data: pos } = await db.from("purchase_orders").select("id").eq("vendor_id", v.id);
    for (const po of pos ?? []) {
      const { data: docs } = await db
        .from("documents")
        .select("id, storage_path")
        .eq("owner_type", "purchase_order")
        .eq("owner_id", po.id);
      if (docs?.length) {
        await db.storage.from("documents").remove(docs.map((d) => d.storage_path));
        await db
          .from("documents")
          .delete()
          .in(
            "id",
            docs.map((d) => d.id),
          );
      }
      await db.from("purchase_orders").delete().eq("id", po.id);
    }
    await db.from("vendors").delete().eq("id", v.id);
  }
}

export async function poTotalsSteps(
  page: Page,
  step: (title: string, body: () => Promise<void>) => Promise<void>,
  stamp: string,
) {
  const vendor = `E2E PO totals ${stamp}`;
  const slug = vendor.replace(/\s+/g, "-");
  let poNumber = "";
  try {
    await step("Procurement totals: live discount and VAT in the dialog", async () => {
      await page.goto("/procurement?new=1");
      const dialog = page.getByRole("dialog", { name: "New purchase" });
      await ex(dialog).toBeVisible();
      await dialog.getByLabel("Vendor", { exact: true }).fill(vendor);
      await dialog.getByLabel("Line 1 description").fill(`E2E ${stamp} Monitor`);
      await dialog.getByLabel("Line 1 quantity").fill("2");
      await dialog.getByLabel("Line 1 unit price in AED").fill("150.50");
      await dialog.getByRole("button", { name: "Add line" }).click();
      await dialog.getByLabel("Line 2 description").fill(`E2E ${stamp} Cable`);
      await dialog.getByLabel("Line 2 quantity").fill("1");
      await dialog.getByLabel("Line 2 unit price in AED").fill("99");

      const summary = dialog.getByTestId("po-summary");
      await ex(summary).toContainText("Subtotal");
      await ex(dialog.getByTestId("po-total")).toContainText("400.00");

      // A discount larger than the subtotal is refused.
      await dialog.getByLabel("Discount in AED").fill("500");
      await dialog.getByRole("button", { name: "Create purchase" }).click();
      await ex(dialog).toContainText("more than the subtotal");
      await ex(dialog).toBeVisible();

      // Discount comes off first, then 5% VAT on what is left: (400 - 50) * 1.05 = 367.50.
      await dialog.getByLabel("Discount in AED").fill("50");
      await ex(dialog.getByTestId("po-total")).toContainText("350.00");
      await dialog.getByLabel("5% VAT").check();
      await ex(dialog.getByTestId("po-vat")).toContainText("17.50");
      await ex(dialog.getByTestId("po-total")).toContainText("367.50");
      await dialog.getByLabel("5% VAT").uncheck();
      await ex(dialog.getByTestId("po-total")).toContainText("350.00");
      await dialog.getByLabel("5% VAT").check();

      await dialog.getByRole("button", { name: "Create purchase" }).click();
      await ex(page).toHaveURL(/[?&]po=PO-\d{4}-\d+/);
      poNumber = /po=(PO-\d{4}-\d+)/.exec(page.url())![1]!;
    });

    await step("Procurement totals: saved total in the list and the panel", async () => {
      const panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
      await ex(panel.locator(".panel-head .fig")).toContainText("367.50");
      const lines = panel.getByRole("table", { name: "Line items" });
      await ex(lines).toContainText("Subtotal");
      await ex(lines).toContainText("400.00");
      await ex(lines).toContainText("Discount");
      await ex(lines).toContainText("50.00");
      await ex(lines).toContainText("VAT 5%");
      await ex(lines).toContainText("17.50");
      // The purchase form has no invoice date field: it is asked for with the invoice file.
      await ex(panel.locator(".kv")).not.toContainText("Invoice date");
      await ex(page.getByRole("row").filter({ hasText: poNumber })).toContainText("367.50");
    });

    await step("Procurement totals: the invoice date names all three files", async () => {
      const panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
      const slotOf = (name: string) => panel.locator(".slot").filter({ hasText: name });
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
      const fileName = (type: string, date: string) => `${slug}_${type}_${date}.pdf`;
      const upload = async (name: string, file: string) => {
        const chooser = page.waitForEvent("filechooser");
        await slotOf(name)
          .getByRole("button", { name: /Missing|Upload/ })
          .first()
          .click();
        await (await chooser).setFiles(pdf(file));
      };

      // No invoice date yet: the approval is named with its upload date.
      await upload("Approval", "e2e-approval.pdf");
      await ex(slotOf("Approval")).toContainText(fileName("Approval", today), { timeout: 30_000 });

      // Invoices are accepted once a purchase is Ordered: set that stage in the Edit dialog.
      await panel.getByRole("button", { name: /^Edit/ }).click();
      const edit = page.getByRole("dialog", { name: "Edit purchase" });
      await ex(edit.getByTestId("po-total")).toContainText("367.50");
      await ex(edit.getByLabel("Discount in AED")).toHaveValue("50");
      await ex(edit.getByLabel("5% VAT")).toBeChecked();
      await expect(edit.getByLabel("Invoice date")).toHaveCount(0);
      await edit.getByLabel("Stage").selectOption("ordered");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await ex(edit).toBeHidden();

      // Uploading the invoice asks for its date.
      await upload("Invoice", "e2e-invoice.pdf");
      const ask = page.getByRole("dialog", { name: "Upload the invoice" });
      await ex(ask.getByLabel("Invoice date")).not.toHaveValue("");
      await ask.getByLabel("Invoice date").fill("2026-09-30");
      await ask.getByRole("button", { name: "Upload" }).click();
      await ex(ask).toBeHidden({ timeout: 30_000 });
      await ex(slotOf("Invoice")).toContainText(fileName("Invoice", "2026-09-30"));
      // The approval uploaded earlier follows the invoice date, and the panel shows it.
      await ex(slotOf("Approval")).toContainText(fileName("Approval", "2026-09-30"));
      await ex(panel.locator(".kv")).toContainText("30 Sep 2026");

      const href = (await slotOf("Invoice")
        .getByRole("link", { name: /^View / })
        .first()
        .getAttribute("href"))!;
      const res = await page.request.get(`${href}?download`, { maxRedirects: 0 });
      expect(res.headers()["location"] ?? "").toContain(
        `/${fileName("Invoice", "2026-09-30")}?download`,
      );

      // A delivery note uploaded afterwards follows it too (no date prompt for it).
      await panel.getByRole("button", { name: "Mark as delivered" }).click();
      await ex(panel.locator(".panel-head")).toContainText("Delivered");
      await upload("Delivery note", "e2e-dn.pdf");
      await ex(slotOf("Delivery note")).toContainText(fileName("Delivery-Note", "2026-09-30"), {
        timeout: 30_000,
      });
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // Changing the date from the panel renames all three.
      await panel.getByRole("button", { name: "Change invoice date" }).click();
      const change = page.getByRole("dialog", { name: "Invoice date" });
      await change.getByLabel("Invoice date").fill("2026-08-01");
      await change.getByRole("button", { name: "Save date" }).click();
      await ex(change).toBeHidden();
      for (const [slotName, type] of [
        ["Approval", "Approval"],
        ["Invoice", "Invoice"],
        ["Delivery note", "Delivery-Note"],
      ] as const)
        await ex(slotOf(slotName)).toContainText(fileName(type, "2026-08-01"));
    });
  } finally {
    await cleanUp(vendor);
  }
}
