import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

/**
 * Focused test of the Board header: one New note button, "Find a note", the colour dots, the
 * "?" help and the phone filters. Uses only notes it creates (text starting "E2E") and
 * deletes them. It never clicks Arrange: that tidies every note on the board, including the
 * owner's real ones (the grid layout is unit-tested and its bulk save is in the db tests).
 * Run: BASE_URL=http://localhost:3500 pnpm test:e2e:focus board-toolbar
 */
const ex = expect.configure({ timeout: 15_000 });

test("board toolbar: one New note, find, colour dots, help, phone filters", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}`;
  const A = `E2E toolbar alpha ${stamp}`;
  const B = `E2E toolbar beta ${stamp}`;
  const shots = process.env.BOARD_SHOTS;
  const shot = async (name: string) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const noteA = () => page.getByRole("group", { name: `Note: ${A}` });
  const noteB = () => page.getByRole("group", { name: `Note: ${B}` });

  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/board");
  await ex(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // let the app hydrate before clicking

  await test.step("remove test notes left by an interrupted earlier run", async () => {
    const left = page.getByRole("group", { name: /^Note: E2E toolbar / });
    while ((await left.count()) > 0) {
      await left.first().getByRole("button", { name: "Delete note" }).click();
      await page
        .getByRole("dialog", { name: "Delete this note?" })
        .getByRole("button", { name: "Delete note" })
        .click();
      await expect(page.getByRole("dialog", { name: "Delete this note?" })).toBeHidden();
    }
  });

  await test.step("only one New note button, in the top bar", async () => {
    await expect(page.getByRole("button", { name: "New note" })).toHaveCount(1);
    await expect(page.locator("main").getByRole("button", { name: /New note/ })).toHaveCount(0);
    // Arrange is there; it is enabled once the board has notes (checked below).
    await expect(page.getByRole("button", { name: "Arrange" })).toBeVisible();
  });

  const addNote = async (text: string, colour: "Pink" | "Blue") => {
    const before = await page.locator(".note.on-board").count();
    await page.getByRole("button", { name: "New note" }).click();
    await page.waitForURL(/\/board$/); // the ?new=1 request is handled and removed
    await ex(page.locator(".note.on-board")).toHaveCount(before + 1);
    await ex(page.locator(".note.on-board textarea:focus")).toBeVisible();
    await page.keyboard.type(text);
    const note = page.locator(".note.on-board", { has: page.locator("textarea:focus") });
    await note.getByRole("radio", { name: colour }).click();
    await page.locator("main h1").click(); // leave the note
    await ex(page.getByRole("group", { name: `Note: ${text}` })).toBeVisible();
  };

  await test.step("create two test notes", async () => {
    await addNote(A, "Pink");
    await ex(page.locator(".eyebrow")).toContainText("Saved");
    // Same page, second press: must add another note (regression).
    await addNote(B, "Blue");
    await ex(page.locator(".eyebrow")).toContainText("Saved");
    await ex(page.getByRole("button", { name: "Arrange" })).toBeEnabled();
  });

  const find = page.getByRole("textbox", { name: "Find a note" });
  await test.step("find a note dims the others; Esc clears; / focuses", async () => {
    await find.fill(A);
    await ex(noteA()).not.toHaveClass(/dimmed/);
    await ex(noteB()).toHaveClass(/dimmed/);
    await shot("toolbar-search-state");
    await find.press("Escape");
    await expect(find).toHaveValue("");
    await expect(page.locator(".note.dimmed")).toHaveCount(0);
    await page.locator("main h1").click();
    await page.keyboard.press("/");
    await ex(find).toBeFocused();
    await find.press("Escape"); // empty: leaves the field
    await ex(find).not.toBeFocused();
  });

  await test.step("colour dots filter, and are toggles", async () => {
    const pink = page.getByRole("button", { name: "Pink notes" });
    await expect(pink).toHaveAttribute("aria-pressed", "false");
    await pink.click();
    await expect(pink).toHaveAttribute("aria-pressed", "true");
    await ex(noteA()).not.toHaveClass(/dimmed/);
    await ex(noteB()).toHaveClass(/dimmed/);
    await page.getByRole("button", { name: "Blue notes" }).click();
    await ex(noteB()).not.toHaveClass(/dimmed/);
    await pink.click();
    await expect(pink).toHaveAttribute("aria-pressed", "false");
    await ex(noteA()).toHaveClass(/dimmed/);
    await page.getByRole("button", { name: "Blue notes" }).click();
    await expect(page.locator(".note.dimmed")).toHaveCount(0);
  });

  await test.step("the ? button shows the instructions", async () => {
    const help = page.getByRole("button", { name: "How the board works" });
    await help.hover();
    const tip = page.locator(".tip", { hasText: "Drag a note to move it" });
    await ex(tip).toBeVisible();
    await expect(tip).toContainText("arrow keys move it");
    await expect(tip).toContainText("Delete removes");
    await shot("toolbar-help-open");
    await page.mouse.move(5, 5);
    await page.mouse.move(300, 600, { steps: 5 });
    await expect(tip).toBeHidden();
  });

  await test.step("phone: search and colour dots hide instead of dim; no Arrange", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await ex(page.locator(".board-stack")).toBeVisible();
    await expect(page.getByRole("button", { name: "Arrange" })).toHaveCount(0);
    await ex(noteA()).toBeVisible();
    await ex(noteB()).toBeVisible();
    await page.getByRole("textbox", { name: "Find a note" }).fill(A);
    await ex(noteA()).toBeVisible();
    await ex(noteB()).toHaveCount(0);
    await page.getByRole("textbox", { name: "Find a note" }).fill("");
    await page.getByRole("button", { name: "Blue notes" }).click();
    await ex(noteB()).toBeVisible();
    await ex(noteA()).toHaveCount(0);
    await shot("toolbar-phone-filtered");
    await page.getByRole("button", { name: "Blue notes" }).click();
    await page.getByRole("textbox", { name: "Find a note" }).fill(`zzz-none-${stamp}`);
    await ex(page.getByText("No notes match.")).toBeVisible();
  });

  await test.step("clean up the test notes", async () => {
    await page.getByRole("textbox", { name: "Find a note" }).fill("");
    for (const text of [A, B]) {
      const n = page.getByRole("group", { name: `Note: ${text}` });
      await n.getByRole("button", { name: "Delete note" }).click();
      await page
        .getByRole("dialog", { name: "Delete this note?" })
        .getByRole("button", { name: "Delete note" })
        .click();
      await ex(n).toHaveCount(0);
    }
    await page.waitForTimeout(16_000); // the page removes them for good after the grace period
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await ex(noteA()).toHaveCount(0);
    await ex(noteB()).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
