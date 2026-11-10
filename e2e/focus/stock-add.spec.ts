import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signIn } from "./sign-in";

// Add-to-stock dialog: two items with specifications and notes, checked on the Stock list,
// then removed at DB level by their exact E2E tags. STOCK_ADD_SHOTS=<folder> saves screenshots.
test("add two stock items through the dialog", async ({ page }) => {
  const stamp = `${Date.now()}`.slice(-8);
  const tags = [`E2E-ADD-${stamp}-A`, `E2E-ADD-${stamp}-B`];
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const shots = process.env.STOCK_ADD_SHOTS;
  const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: `${shots}/stock-add-${name}.png` });
  };
  try {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/stock?new=1");
    const dialog = page.getByRole("dialog", { name: "Add to stock" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(dialog.getByText("Enter a tag.")).toBeVisible();
    await shot("1440-light-error");
    if (shots) {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(600);
      await shot("1440-dark-error");
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/stock?new=1");
      await dialog.getByLabel("Row 1 tag").fill(tags[0]!);
      await dialog.getByRole("button", { name: "Add item" }).click();
      await shot("390-light-error");
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/stock?new=1");
      await dialog.getByRole("button", { name: "Add item" }).click();
    }
    await dialog.getByLabel("Row 1 tag").fill(tags[0]!);
    await dialog.getByLabel("Row 1 model").fill(`E2E Laptop ${stamp}`);
    await dialog.getByLabel("Row 1 specifications").fill("16 GB / 512 GB, M3");
    await dialog.getByLabel("Row 1 notes").fill("E2E note one");
    await dialog.getByRole("button", { name: "Add another item" }).click();
    await expect(dialog.getByLabel("Row 2 tag")).toBeFocused();
    await expect(dialog.getByLabel("Row 2 model")).toHaveValue(`E2E Laptop ${stamp}`);
    await expect(dialog.getByLabel("Row 2 specifications")).toHaveValue("16 GB / 512 GB, M3");
    await dialog.getByLabel("Row 2 tag").fill(tags[1]!);
    await dialog.getByLabel("Row 2 notes").fill("E2E note two");
    const overflow = await dialog.evaluate((el) =>
      [el, ...el.querySelectorAll("*")]
        .filter(
          (e) =>
            !e.classList.contains("sr-only") &&
            e.scrollWidth > e.clientWidth + 1 &&
            getComputedStyle(e).overflowX !== "visible",
        )
        .map((e) => e.tagName + "." + e.className),
    );
    expect(overflow).toEqual([]);
    if (shots) {
      await shot("1440-light-two-items");
    }
    await dialog.getByRole("button", { name: "Add 2 items" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/stock$/);
    await page.waitForLoadState("networkidle");
    for (const tag of tags)
      await expect(page.getByRole("row").filter({ hasText: tag })).toBeVisible();
    const { data } = await db
      .from("stock_items")
      .select("tag,specifications,notes")
      .in("tag", tags);
    expect(data?.length).toBe(2);
    expect(data?.every((r) => r.specifications === "16 GB / 512 GB, M3" && r.notes)).toBe(true);
  } finally {
    await db.from("stock_items").delete().in("tag", tags);
  }
});
