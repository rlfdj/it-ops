import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { poTotalsSteps } from "./focus/po-totals-steps";
import { boardSteps } from "./focus/board-steps";
import { deleteSteps } from "./focus/delete-steps";
import { seatRosterSteps } from "./focus/seat-roster-steps";

/**
 * Write-workflow end-to-end test. Drives every create / edit / tick / upload / delete flow
 * through the real UI against the live (dummy-data) database. Run with --project=desktop.
 */
// Dev-server compiles and server actions can be slow on first use.
const ex = expect.configure({ timeout: 15_000 });

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
  await ex(page).toHaveURL(/\/$/);
}

const STAMP = `${Date.now()}`;
const SHORT = STAMP.slice(-8);
const VENDOR = `E2E Vendor ${STAMP}`;
const TAG_A = `E2E-${SHORT}-A`;
const TAG_B = `E2E-${SHORT}-B`;
const TAG_C = `E2E-${SHORT}-C`;
const SERIAL = `SN-${SHORT}`;
const TASK_TITLE = `E2E task ${STAMP}`;
const DIALOG_TASK = `E2E dialog task ${STAMP}`;
const ALERT_TASK = `E2E alert task ${STAMP}`;
const SUB_NAME = `E2E Sub ${STAMP}`;
const PERSON = `E2E Person ${STAMP}`;
// New uploads are renamed Vendor_Type_Date.ext (spaces become hyphens).
const slug = (text: string) => text.trim().replace(/[\s-]+/g, "-");
const VENDOR_SLUG = slug(VENDOR);
// Purchase documents are named [InvoiceNumber_]Vendor_[Project_]Type_Date.ext.
const PROJECT = "E2E Project";
const PO_SLUG = `${VENDOR_SLUG}_${slug(PROJECT)}`;
const INVOICE_NO = `INV-${SHORT}`;
const SUB_SLUG = slug(SUB_NAME);

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ),
});

const dubaiDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
};
const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${mon[Number(m) - 1]}`;
};

/** Sorts a list by a column label, using the header button or, when the table is narrow, the Sort menu. */
async function sortBy(page: Page, label: string, menuLabel: string) {
  const header = page.getByRole("columnheader").getByRole("button", { name: label }).first();
  // Wait for the table (wide) or the Sort menu (narrow) before choosing between them.
  await header
    .or(page.getByRole("combobox", { name: "Sort" }))
    .first()
    .waitFor();
  if (await header.isVisible()) await header.click();
  else await page.getByRole("combobox", { name: "Sort" }).selectOption({ label: menuLabel });
}

// The DateField shows dates as "13 Oct 2026".
const longDay = (iso: string) => `${shortDay(iso)} ${iso.slice(0, 4)}`;

const row = (page: Page, text: string | RegExp) => page.getByRole("row").filter({ hasText: text });

// The run edits the live workspace settings (name, rate, currency, time zone, logo) and puts
// them back. A run that fails half-way would leave test values behind, and the next run would
// then "restore" those, so the settings are saved before the run and restored after it,
// whatever happens.
const SETTINGS_COLUMNS = "workspace_name, usd_aed_rate, base_currency, time_zone, logo_path";
let savedSettings: Record<string, unknown> | null = null;
const settingsTable = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  }).from("workspace_settings");
test.beforeAll(async () => {
  const { data, error } = await settingsTable().select(SETTINGS_COLUMNS).eq("id", 1).single();
  if (error) throw error;
  if (String(data.workspace_name).startsWith("E2E ")) {
    throw new Error(
      `Workspace settings still hold test values (${data.workspace_name}); fix them first.`,
    );
  }
  savedSettings = data;
});
test.afterAll(async () => {
  if (!savedSettings) return;
  const { error } = await settingsTable().update(savedSettings).eq("id", 1);
  if (error) throw error;
});

test("every write workflow works through the UI", async ({ page, browser }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const clean = async (label: string) => {
    ex(errors, `${label}: page errors`).toEqual([]);
    await ex(page.locator(".alert.red"), `${label}: visible error line`).toHaveCount(0);
  };

  await signIn(page);

  // ---- baseline numbers for the dashboard step ----
  const statValue = async (label: string) =>
    Number(
      (await page.locator(".stat", { hasText: label }).first().locator(".v").innerText()).replace(
        /\D/g,
        "",
      ),
    );
  const openTaskCount = async () => {
    await page.goto("/tasks");
    const text = await page.locator(".page-head .eyebrow").innerText();
    return Number(/^(\d+) open/i.exec(text.trim())?.[1]);
  };
  await page.goto("/");
  await ex(page.getByRole("heading", { level: 1 })).toHaveText(/^Good /);
  const baseline = {
    stock: await statValue("In stock"),
    renewals: await statValue("Renewals this month"),
    tasks: await openTaskCount(),
  };

  let poNumber = "";
  let panel: Locator;

  // ================== 0. SHELL: skip link, validation ==================
  await test.step("Shell: skip link is the first tab stop and moves focus to the content", async () => {
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle"); // let the app hydrate before using the keyboard
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await ex(skip).toBeFocused();
    await ex(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await ex(page.locator("main#content")).toBeFocused();
  });

  await test.step("Validation: errors appear beside their fields, before any request", async () => {
    await page.goto("/procurement?new=1");
    const dialog = page.getByRole("dialog", { name: "New purchase" });
    const vendor = dialog.getByLabel("Vendor", { exact: true });
    const requests: string[] = [];
    page.on("request", (r) => r.method() === "POST" && requests.push(r.url()));
    await dialog.getByLabel("Line 1 quantity").fill("0");
    await dialog.getByRole("button", { name: "Create purchase" }).click();
    await ex(vendor).toHaveAttribute("aria-invalid", "true");
    await ex(vendor).toBeFocused(); // first invalid field takes focus
    await ex(dialog.locator(".field-msg", { hasText: "Choose or enter a vendor" })).toBeVisible();
    await ex(dialog.locator(".field-msg", { hasText: "at least 1" })).toBeVisible();
    await ex(dialog.locator(".field-msg", { hasText: "Describe the item" })).toBeVisible();
    await ex(dialog.locator(".dialog-foot .alert.red")).toHaveCount(0);
    ex(requests, "nothing was sent to the server").toEqual([]);
    // Fixing a field clears its message straight away.
    await vendor.fill("Anyone");
    await ex(vendor).not.toHaveAttribute("aria-invalid", "true");

    // Removing a line you typed in asks first; Cancel keeps it.
    await dialog.getByRole("button", { name: "Add line" }).click();
    await dialog.getByLabel("Line 2 description").fill("Throwaway");
    await dialog.getByRole("button", { name: "Remove line 2" }).click();
    const confirm = page.getByRole("dialog", { name: "Remove line 2?" });
    await ex(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await ex(dialog.getByLabel("Line 2 description")).toHaveValue("Throwaway");
    await dialog.getByRole("button", { name: "Remove line 2" }).click();
    await confirm.getByRole("button", { name: "Remove line" }).click();
    await ex(dialog.getByLabel("Line 2 description")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await ex(dialog).toBeHidden();
  });

  // The live data may be empty (the owner starts from a clean slate), so these keyboard checks
  // make sure Tasks has five rows first (adding E2E tasks), and skip lists that have no rows.
  const rowCount = async (path: string) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    return page.locator("[role=row][data-row-id]").count();
  };
  await test.step("Keyboard: E2E tasks so the lists have rows", async () => {
    // Five rows, so J/K have room to move even when a row starts out selected.
    const have = await rowCount("/tasks");
    for (let n = have + 1; n <= 5; n++) {
      await page.getByRole("textbox", { name: "Quick add task" }).fill(`E2E key ${n} ${STAMP}`);
      await page.keyboard.press("Enter");
      await ex(page.locator(".toasts")).toContainText("Task added");
    }
    await ex.poll(() => rowCount("/tasks")).toBeGreaterThanOrEqual(5);
  });

  await test.step("Keyboard: every table has a hint strip and focusable rows", async () => {
    for (const path of ["/procurement", "/subscriptions", "/stock", "/tasks"]) {
      if (!(await rowCount(path))) continue; // an empty list shows no hint strip (B-25)
      await ex(page.locator(".table-hint").first(), `${path} hint strip`).toBeVisible();
      await ex(
        page.locator("[role=row][data-row-id][tabindex='0']"),
        `${path} has exactly one row in the tab order`,
      ).toHaveCount(1);
    }
    await page.goto("/tasks");
    await page.locator("main h1").click();
    await page.keyboard.press("j");
    await ex(
      page.locator("[role=row][data-row-id]:focus"),
      "J moves DOM focus to a row",
    ).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await ex(page.locator("[role=row][data-row-id]:focus")).toHaveCount(1);
  });

  await test.step("Keyboard: J moves up and K moves down, and the hint strips say so", async () => {
    for (const path of ["/procurement", "/subscriptions", "/stock", "/tasks"]) {
      if (!(await rowCount(path))) continue;
      await ex(page.locator(".table-hint").first(), `${path} hint`).toContainText(/J up.*K down/s);
      await ex(page.locator(".table-hint").first(), `${path} hint`).not.toContainText("J / K");
    }
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.locator("main h1").click();
    const focusedId = () =>
      page.locator("[role=row][data-row-id]:focus").getAttribute("data-row-id");
    await page.keyboard.press("k"); // nothing selected yet: lands on the first row
    await ex(page.locator("[role=row][data-row-id]:focus")).toHaveCount(1);
    const first = await focusedId();
    await page.keyboard.press("k"); // down
    await ex.poll(focusedId, "K moves down a row").not.toBe(first);
    const second = await focusedId();
    await page.keyboard.press("k");
    await ex.poll(focusedId).not.toBe(second);
    await page.keyboard.press("j"); // up
    await ex.poll(focusedId, "J moves back up a row").toBe(second);
    await page.keyboard.press("j");
    await ex.poll(focusedId).toBe(first);
  });

  await test.step("Shell: app bar; the sidebar collapses to an icon rail with its menu button and [", async () => {
    await page.goto("/procurement");
    await page.waitForLoadState("networkidle");
    await ex(page.locator(".top .crumb"), "module pages do not repeat the title").toHaveCount(0);
    await ex(page.locator(".top").getByRole("link", { name: "IT Ops — Dashboard" })).toBeVisible();
    await ex(page.locator(".top").getByRole("button", { name: "Account" })).toBeVisible();
    const frame = page.locator(".app");
    const side = page.locator("aside.side");
    const sideWidth = async () => (await side.boundingBox())!.width;
    const toggle = page.getByRole("button", { name: "Collapse sidebar" });
    await ex(toggle).toHaveAttribute("aria-expanded", "true");
    await ex(side.getByRole("link", { name: "Stock" })).toBeVisible();
    const widthShown = (await page.locator(".main").boundingBox())!.width;
    // The slide is kept even when the device asks for reduced motion (owner's choice).
    await page.emulateMedia({ reducedMotion: "reduce" });
    ex(await side.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.22s");
    await page.emulateMedia({ reducedMotion: null });

    await toggle.click();
    await ex(frame).toHaveAttribute("data-sidebar", "hidden");
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await ex(expand).toHaveAttribute("aria-expanded", "false");
    await ex.poll(sideWidth, { message: "collapses to the icon rail" }).toBeLessThan(70);
    // Icons stay as links; the label becomes the tooltip.
    await ex(side.locator('a[href="/stock"]')).toBeVisible();
    await ex(side.locator('a[href="/stock"]')).toHaveAttribute("title", /^Stock/);
    const widthRail = (await page.locator(".main").boundingBox())!.width;
    ex(widthRail, "main widens").toBeGreaterThan(widthShown + 100); // 172 css px, 138 at 80%

    // Remembered in a cookie that the server reads: still collapsed after a reload, no flash.
    await page.reload();
    await ex(frame).toHaveAttribute("data-sidebar", "hidden");
    ex(await sideWidth()).toBeLessThan(70);

    // [ expands it (focus not in a field), and collapses it again.
    await page.waitForLoadState("networkidle");
    await page.locator("main h1").click();
    await page.keyboard.press("[");
    await ex(frame).toHaveAttribute("data-sidebar", "shown");
    await ex(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("[");
    await ex(frame).toHaveAttribute("data-sidebar", "hidden");
    // Typing "[" in a field does nothing.
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Quick add task" }).fill("[");
    await ex(frame).toHaveAttribute("data-sidebar", "hidden");
    await page.getByRole("textbox", { name: "Quick add task" }).fill("");
    // Leave it expanded for the rest of the run.
    await page.locator("main h1").click();
    await page.keyboard.press("[");
    await ex(frame).toHaveAttribute("data-sidebar", "shown");
    await page.reload();
    await ex(frame).toHaveAttribute("data-sidebar", "shown");
    await ex.poll(sideWidth).toBeGreaterThan(150); // 232 css px, 186 at 80%
  });

  await test.step("Shell: sidebar counts say what they count; New on the Dashboard is a create menu", async () => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const stock = page.locator("aside.side").getByRole("link", { name: /^Stock/ });
    await ex(stock).toHaveAttribute("title", /^Stock · \d+ items? in stock$/);
    await ex(stock.locator(".n .sr-only")).toHaveText(/items? in stock/);
    await ex(
      page.locator("aside.side").getByRole("link", { name: /^Procurement/ }),
    ).toHaveAttribute("title", /open purchase order/);

    await page.locator(".top").getByRole("button", { name: /^New/ }).click();
    const menu = page.getByRole("menu");
    for (const name of [
      "New purchase",
      "Add stock",
      "New task",
      "New subscription",
      "New checklist",
    ])
      await ex(menu.getByRole("menuitem", { name })).toBeVisible();
    await ex(page.getByRole("dialog", { name: "Search" })).toBeHidden();
    await page.keyboard.press("Escape");
    await ex(menu).toBeHidden();
    await page.locator("main h1").click();
    await page.keyboard.press("n");
    await ex(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "New task" }).click();
    await ex(page.getByRole("dialog", { name: "New task" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Onboarding: module page header; New checklist is the one primary action", async () => {
    await page.goto("/onboarding");
    await ex(page.getByRole("heading", { level: 1 })).toHaveText("On / Offboarding");
    await ex(page.locator("main .page-head .eyebrow").first()).toHaveText(/in progress/);
    await page
      .locator(".top")
      .getByRole("button", { name: /^New checklist/ })
      .click();
    await ex(page.getByRole("dialog", { name: "New checklist" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Phone: navigation is a drawer behind a menu button; renewals are a list", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    try {
      await page.goto("/subscriptions");
      await page.waitForLoadState("networkidle");
      await ex(page.locator("aside.side")).toBeHidden();
      const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      ex(h1.y, "content starts under the bar, not under a screen of navigation").toBeLessThan(200);
      await ex(page.locator(".track")).toBeHidden();
      const list = page.getByRole("list", { name: /Renewals and contract ends/ });
      if (await list.count()) await ex(list).toBeVisible();

      await page.getByRole("button", { name: "Open navigation" }).click();
      const drawer = page.getByRole("dialog");
      await ex(drawer.getByRole("link", { name: /^Stock/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await ex(drawer).toBeHidden();

      await page.getByRole("button", { name: "Open navigation" }).click();
      await drawer.getByRole("link", { name: /^Tasks/ }).click();
      await page.waitForURL(/\/tasks/);
      await ex(drawer, "the drawer closes after following a link").toBeHidden();
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  await test.step("Detail sheets below 1024px: Procurement and Subscriptions open as a slide-over (900px) or bottom sheet (390px) (B-05)", async () => {
    const sheet = page.locator("[data-detail-sheet]");
    try {
      for (const [width, height] of [
        [900, 800],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        for (const [path, param] of [
          ["/procurement", "po"],
          ["/subscriptions", "sub"],
        ] as const) {
          const at = `${path} at ${width}px`;
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          const rows = page.locator("[role='row'][data-row-id]");
          if ((await rows.count()) < 2) continue;
          await ex(sheet, `${at}: closed until a row is opened`).toBeHidden();
          ex(new URL(page.url()).searchParams.has(param), `${at}: no param yet`).toBe(false);
          // The static panel under the list is gone.
          await ex(page.locator(".split > .panel"), `${at}: no panel under the list`).toBeHidden();

          // Open: the list keeps its scroll position, the sheet fits the window, focus is inside.
          // The first row, so K below always has a row to move to (the list may hold only two).
          await rows.nth(0).scrollIntoViewIfNeeded();
          const before = await page.evaluate(() => window.scrollY);
          await rows.nth(0).click();
          await ex(sheet, `${at}: opening a row opens the sheet`).toBeVisible();
          ex(new URL(page.url()).searchParams.has(param), `${at}: param in the URL`).toBe(true);
          expect(await page.evaluate(() => window.scrollY), `${at}: list scroll kept`).toBe(before);
          // Let the slide-in finish before measuring.
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
          const box = (await sheet.boundingBox())!;
          const win = page.viewportSize()!;
          expect(box.y + box.height, `${at}: sheet fits the window`).toBeLessThanOrEqual(
            win.height + 1,
          );
          expect(box.width, `${at}: sheet fits the width`).toBeLessThanOrEqual(win.width);
          if (width > 760)
            expect(box.x + box.width, `${at}: slide-over is on the right`).toBe(win.width);
          else expect(box.y, `${at}: phone sheet is at the bottom`).toBeGreaterThan(0);
          await ex(sheet.getByRole("button", { name: "Close detail" })).toBeVisible();
          expect(
            await page.evaluate(() => !!document.activeElement?.closest("[data-detail-sheet]")),
            `${at}: focus moved into the sheet`,
          ).toBe(true);

          // K moves down and J up; the sheet follows (wait for it to show that row: against a
          // distant database the detail can arrive a second or two after the URL changes).
          const first = new URL(page.url()).searchParams.get(param);
          const heading = sheet.getByRole("heading").first();
          const firstTitle = (await heading.textContent())!.trim();
          await page.keyboard.press("k");
          await ex
            .poll(() => new URL(page.url()).searchParams.get(param), `${at}: K`)
            .not.toBe(first);
          await ex(heading, `${at}: K shows the next row`).not.toHaveText(firstTitle);
          await page.keyboard.press("j");
          await ex.poll(() => new URL(page.url()).searchParams.get(param), `${at}: J`).toBe(first);
          await ex(heading, `${at}: J shows the first row again`).toHaveText(firstTitle);

          // Esc closes it and focus returns to the row.
          await page.keyboard.press("Escape");
          await ex(sheet, `${at}: Esc closes`).toBeHidden();
          ex(new URL(page.url()).searchParams.has(param), `${at}: param cleared`).toBe(false);
          await ex
            .poll(
              () => page.evaluate(() => document.activeElement?.getAttribute("role")),
              `${at}: focus back on a row`,
            )
            .toBe("row");

          // Close button and Back.
          await rows.nth(1).click();
          await ex(sheet).toBeVisible();
          await sheet.getByRole("button", { name: "Close detail" }).click();
          await ex(sheet, `${at}: close button`).toBeHidden();
          await rows.nth(1).click();
          await ex(sheet).toBeVisible();
          await page.goBack();
          await ex(sheet, `${at}: Back closes`).toBeHidden();
          ex(page.url(), `${at}: Back stays on the list`).toContain(path);
        }
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  // ======================= 1. PROCUREMENT =======================
  await test.step("Procurement: create purchase with a new vendor and two lines", async () => {
    await page.goto("/procurement");
    const poLinks = page.getByRole("table", { name: "Purchase orders" }).locator("a.lnk");
    // The page may show its loading skeleton first; then rows, or the empty state on a wiped workspace.
    const emptyState = page.locator('main a[href="/procurement?new=1"]');
    await ex(poLinks.or(emptyState).first()).toBeVisible();
    const existing = await poLinks.allInnerTexts();
    const maxExisting = Math.max(
      0,
      ...existing
        .map((n) => /^PO-(\d{4})-(\d+)$/.exec(n.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[2])),
    );

    // The N shortcut opens the dialog (focus must not be in a field).
    await page.locator("main h1").click();
    await page.keyboard.press("n");
    await ex(page).toHaveURL(/\/procurement\?new=1/);
    const dialog = page.getByRole("dialog", { name: "New purchase" });
    await ex(dialog).toBeVisible();

    await dialog.getByLabel("Vendor", { exact: true }).fill(VENDOR);
    await dialog.getByLabel("Project").fill(PROJECT);
    await dialog.getByLabel("Line 1 description").fill(`E2E ${STAMP} Monitor`);
    await dialog.getByLabel("Line 1 quantity").fill("2");
    await dialog.getByLabel("Line 1 unit price in AED").fill("150.50");
    await dialog.getByRole("button", { name: "Add line" }).click();
    await dialog.getByLabel("Line 2 description").fill(`E2E ${STAMP} Cable`);
    await dialog.getByLabel("Line 2 quantity").fill("1");
    await dialog.getByLabel("Line 2 unit price in AED").fill("99");
    await ex(dialog.getByTestId("po-total")).toContainText("400");
    await dialog.getByRole("button", { name: "Create purchase" }).click();

    await ex(page).toHaveURL(/[?&]po=PO-\d{4}-\d+/);
    poNumber = /po=(PO-\d{4}-\d+)/.exec(page.url())![1]!;
    await ex(page.locator(".toasts")).toContainText(`Created ${poNumber}`);
    const seq = Number(/-(\d+)$/.exec(poNumber)![1]);
    // Numbers come from a counter, so deleted POs leave gaps; it must still be the newest.
    ex(seq, "new PO number is above every existing one").toBeGreaterThan(maxExisting);

    panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
    await ex(panel.locator(".panel-head")).toContainText("Requested");
    await ex(panel.locator(".panel-head")).toContainText(VENDOR);
    await ex(panel.locator(".kv")).toContainText(PROJECT);
    await ex(panel.locator(".panel-head .fig")).toContainText("400.00");
    await ex(panel.getByRole("table", { name: "Line items" })).toContainText("Monitor");
    await ex(row(page, poNumber)).toContainText("Requested");
    await clean("create PO");
  });

  await test.step("Procurement: edit a line", async () => {
    await panel.getByRole("button", { name: /^Edit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit purchase" });
    await ex(dialog.getByLabel("Project")).toHaveValue(PROJECT);
    await dialog.getByLabel("Invoice number").fill(INVOICE_NO);
    await dialog.getByLabel("Line 2 description").fill(`E2E ${STAMP} Cable (edited)`);
    await dialog.getByLabel("Line 2 quantity").fill("3");
    await ex(dialog.getByTestId("po-total")).toContainText("598");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await ex(dialog).toBeHidden();
    await ex(panel.getByRole("table", { name: "Line items" })).toContainText("(edited)");
    await ex(panel.locator(".panel-head .fig")).toContainText("598.00");
    await ex(panel.locator(".kv")).toContainText(INVOICE_NO);
    await clean("edit PO");
  });

  const slot = (name: string) => panel.locator(".slot").filter({ hasText: name });

  await test.step("Procurement: approval file auto-approves, then Mark as ordered", async () => {
    // The dashed "Missing" zone is itself a button that opens the file picker.
    const chooser = page.waitForEvent("filechooser");
    await slot("Approval")
      .getByRole("button", { name: /Missing — attach to approve/ })
      .click();
    await (await chooser).setFiles(pdf("e2e-approval.pdf"));
    await ex(panel.locator(".panel-head")).toContainText("Approved", { timeout: 30_000 });
    // New uploads are renamed Vendor_Type_Date.ext (Dubai date); the tooltip shows that name only.
    await ex(slot("Approval")).toContainText(`${PO_SLUG}_Approval_${dubaiDate()}.pdf`);
    await ex(slot("Approval").locator(".file")).toHaveAttribute(
      "title",
      `${PO_SLUG}_Approval_${dubaiDate()}.pdf`,
    );
    await panel.getByRole("button", { name: "Mark as ordered" }).click();
    await ex(panel.locator(".panel-head")).toContainText("Ordered");
    await clean("approve + order");
  });

  await test.step("Procurement: 'Only missing documents' and stage tabs reflect the PO", async () => {
    // Ordered with no invoice yet: the invoice is missing.
    await page.goto(`/procurement?missing=1&po=${poNumber}`);
    await ex(row(page, poNumber)).toBeVisible();
    await ex(page.getByLabel("Only missing documents")).toBeChecked();
    await page.goto(`/procurement?stage=ordered`);
    await ex(row(page, poNumber)).toBeVisible();
    await page.goto(`/procurement?stage=requested`);
    await ex(row(page, poNumber)).toHaveCount(0);
    await page.goto(`/procurement?po=${poNumber}`);
    await clean("filters (ordered)");
  });

  await test.step("Procurement: invoice + delivery note, deliver, close", async () => {
    panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
    await slot("Invoice").locator("input[type=file]").setInputFiles(pdf("e2e-invoice.pdf"));
    // The invoice upload asks for the invoice date (default today); keep it.
    const askDate = page.getByRole("dialog", { name: "Upload the invoice" });
    await ex(askDate).toBeVisible();
    await askDate.getByRole("button", { name: "Upload" }).click();
    await ex(slot("Invoice")).toContainText(`${PO_SLUG}_Invoice_${dubaiDate()}.pdf`, {
      timeout: 30_000,
    });
    await panel.getByRole("button", { name: "Mark as delivered" }).click();
    await ex(panel.locator(".panel-head")).toContainText("Delivered");
    // Owner rule: no closing until the approval, invoice and delivery note are all attached.
    await ex(panel.getByRole("button", { name: "Close purchase" })).toBeDisabled();
    await ex(panel).toContainText("Upload the delivery note to close this purchase.");
    await slot("Delivery note").locator("input[type=file]").setInputFiles(pdf("e2e-dn.pdf"));
    await ex(slot("Delivery note")).toContainText(`${PO_SLUG}_Delivery-Note_${dubaiDate()}.pdf`, {
      timeout: 30_000,
    });
    // Bulk close (B-16): select the delivered PO, confirm, Undo brings it back to Delivered.
    await page.goto(`/procurement?stage=delivered&po=${poNumber}`);
    await row(page, poNumber)
      .getByRole("checkbox", { name: `Select ${poNumber}` })
      .check();
    const bar = page.getByRole("group", { name: "Selected purchases" });
    await ex(bar).toContainText("1 selected");
    await ex(bar.getByRole("link", { name: "Export selected" })).toHaveAttribute(
      "href",
      new RegExp(`po=${poNumber}`),
    );
    await bar.getByRole("button", { name: /^Close delivered/ }).click();
    const closeDialog = page.getByRole("dialog", { name: `Close ${poNumber}?` });
    await ex(closeDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await closeDialog.getByRole("button", { name: "Close purchases" }).click();
    await ex(row(page, poNumber)).toHaveCount(0);
    const closedToast = page.locator(".toasts .toast", { hasText: `Closed ${poNumber}` });
    await closedToast.getByRole("button", { name: "Undo" }).click();
    await ex(row(page, poNumber)).toBeVisible();
    panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
    await ex(panel.locator(".panel-head")).toContainText("Delivered");
    await panel.getByRole("button", { name: "Close purchase" }).click();
    await ex(panel.locator(".panel-head")).toContainText("Closed");
    await clean("deliver + close");
  });

  await test.step("Procurement: attached file opens via /documents/{id}", async () => {
    const approval = slot("Approval");
    // View / Change / Download are icon buttons with labels and tooltips (hover and focus).
    for (const [name, role, text] of [
      [/^View approval/, "link", "View"],
      [/^Change approval/, "button", "Change"],
      [/^Download approval/, "link", "Download"],
    ] as const) {
      const control = approval.getByRole(role, { name });
      await control.focus();
      await ex(
        page.getByRole("tooltip").filter({ hasText: text }).first(),
        `${text} tooltip on focus`,
      ).toBeVisible();
    }
    await approval.getByRole("link", { name: /^View approval/ }).hover();
    await ex(
      page.getByRole("tooltip").filter({ hasText: "View" }).first(),
      "tooltip on hover",
    ).toBeVisible();
    const href = await approval.getByRole("link", { name: /^View approval/ }).getAttribute("href");
    ex(href).toMatch(/^\/documents\/[0-9a-f-]{36}/);
    // expect.soft: a failure here is reported but does not stop the remaining workflows.
    const redirect = await page.request.get(href!, { maxRedirects: 0 });
    ex.soft(redirect.status(), "GET /documents/{id} redirects to the named URL").toBeLessThan(400);
    ex.soft([302, 303, 307, 308]).toContain(redirect.status());
    // Viewing lands on this site under the conventional name (so the viewer saves it so).
    ex.soft(redirect.headers()["location"] ?? "").toContain(
      `/${PO_SLUG}_Approval_${dubaiDate()}.pdf`,
    );
    // The download filename is the new name.
    const download = await page.request.get(`${href}?download`, { maxRedirects: 0 });
    ex.soft(download.headers()["location"] ?? "", "download filename").toContain(
      `/${PO_SLUG}_Approval_${dubaiDate()}.pdf?download`,
    );
    // The invoice file leads with the invoice number; the approval's name never has it.
    const invoiceHref = await slot("Invoice")
      .getByRole("link", { name: /^Download invoice/ })
      .getAttribute("href");
    const invoiceDownload = await page.request.get(`${invoiceHref}?download`, {
      maxRedirects: 0,
    });
    ex.soft(
      decodeURIComponent(invoiceDownload.headers()["location"] ?? "")
        .split("/")
        .pop() ?? "",
      "invoice download name",
    ).toMatch(new RegExp(`^${INVOICE_NO}_${PO_SLUG}_Invoice_`));
    ex.soft(download.headers()["location"] ?? "", "approval has no invoice number").not.toContain(
      INVOICE_NO,
    );
    const followed = await page.request.get(href!);
    ex.soft(followed.status()).toBe(200);
    ex.soft(followed.headers()["content-type"] ?? "").toContain("pdf");
    ex.soft(followed.headers()["content-disposition"] ?? "", "viewed inline").toMatch(/^inline;/);
    // Download is sent as an attachment from this site, so it saves straight away.
    const saved = await page.request.get(`${href}?download`);
    ex.soft(saved.headers()["content-disposition"] ?? "", "downloaded as attachment").toContain(
      `attachment; filename="${PO_SLUG}_Approval_${dubaiDate()}.pdf"`,
    );
  });

  await test.step("Procurement: closed PO is in the Closed tab and no longer 'missing'", async () => {
    await page.goto(`/procurement?stage=closed&po=${poNumber}`);
    await ex(row(page, poNumber)).toBeVisible();
    await ex(
      page.getByRole("navigation", { name: "Stage" }).getByRole("link", { name: /^Closed/ }),
    ).toHaveAttribute("aria-current", "page");
    await page.goto(`/procurement?missing=1`);
    await ex(row(page, poNumber)).toHaveCount(0);
    const csv = await page.request.get("/procurement/export");
    ex(csv.status()).toBe(200);
    ex(await csv.text()).toContain(poNumber);
    await clean("closed filters");
  });

  await test.step("Procurement: text filter, sort, filtered counts, export and titles (B-09, B-25, B-27)", async () => {
    // The filter box is kept in ?q= and narrows the list and the tab counts together.
    await page.goto("/procurement");
    await page.locator("[data-filter]").fill(VENDOR);
    await ex(page).toHaveURL(/[?&]q=/);
    await ex(row(page, poNumber)).toBeVisible();
    await ex(
      page.getByRole("navigation", { name: "Stage" }).getByRole("link", { name: /^All/ }),
    ).toContainText(/\d+ of \d+/);
    await ex(
      page.getByRole("navigation", { name: "Stage" }).getByRole("link", { name: /^Closed/ }),
    ).toContainText("1");
    await ex(
      page.getByRole("navigation", { name: "Stage" }).getByRole("link", { name: /^Requested/ }),
    ).toContainText("0");
    // Export follows the filter and says so in the file name.
    await ex(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /export\?q=/);
    const filtered = await page.request.get(`/procurement/export?q=${encodeURIComponent(VENDOR)}`);
    ex(filtered.headers()["content-disposition"]).toContain("purchase-orders-filtered");
    const filteredCsv = await filtered.text();
    ex(filteredCsv).toContain(poNumber);
    ex(filteredCsv.trim().split("\n")).toHaveLength(2);
    // Nothing matches: the legend goes and the panel says what to do.
    await page.locator("[data-filter]").fill("zzz no such purchase");
    await ex(page.getByText("No purchases match this stage and filter.")).toBeVisible();
    await ex(page.getByLabel("Document legend")).toHaveCount(0);
    await ex(page.getByText("Pick a stage with purchases, or clear the filter.")).toBeVisible();
    await ex(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0); // still a link: purchases exist

    // Sorting: Amount descending is kept in ?sort= and marked on the header.
    await page.goto("/procurement");
    await sortBy(page, "Amount", "Amount ↑");
    await ex(page).toHaveURL(/sort=-amount/);
    const amounts = await page
      .getByRole("table", { name: "Purchase orders" })
      .locator("[role=cell][data-col=amount]")
      .allInnerTexts();
    const values = amounts
      .map((t) => Number(t.replace(/[^\d.]/g, "")))
      .filter((n) => !Number.isNaN(n));
    ex(values).toEqual([...values].sort((a, b) => b - a));

    // Missing documents: documents and POs are both shown (B-27).
    await ex(page.locator(".stat", { hasText: "Missing docs" }).locator(".s")).toContainText(
      /\d+ POs?/,
    );
    await page.goto("/");
    await ex(page.getByRole("link", { name: /POs? missing \d+ documents?/ })).toBeVisible();

    // The tab and history name the selected purchase (B-25).
    await page.goto(`/procurement?po=${poNumber}`);
    await ex(page).toHaveTitle(new RegExp(`^${poNumber} · Procurement`));
    await clean("procurement list");
  });

  await test.step("Procurement: replacing a file asks first (the old file is deleted)", async () => {
    await page.goto(`/procurement?stage=closed&po=${poNumber}`);
    panel = page.getByRole("complementary", { name: `Purchase ${poNumber}` });
    await slot("Approval").locator("input[type=file]").setInputFiles(pdf("e2e-approval-2.pdf"));
    const confirm = page.getByRole("dialog", { name: /^Replace the .*\?$/ });
    const approvalName = `${PO_SLUG}_Approval_${dubaiDate()}.pdf`;
    await ex(confirm).toContainText(approvalName);
    await ex(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await ex(slot("Approval")).toContainText(approvalName);
    await slot("Approval").locator("input[type=file]").setInputFiles(pdf("e2e-approval-2.pdf"));
    await confirm.getByRole("button", { name: "Replace file" }).click();
    // The replacement reuses the freed name (not -2).
    await ex(page.locator(".toasts")).toContainText("replaced", { timeout: 30_000 });
    await ex(slot("Approval")).toContainText(approvalName);
    await ex(slot("Approval").locator(".file")).toHaveAttribute("title", approvalName);
    await clean("replace file");
  });

  // ============================ 2. STOCK ============================
  await test.step("Stock: add two rows with carry-down", async () => {
    await page.goto("/stock?new=1");
    const dialog = page.getByRole("dialog", { name: "Add to stock" });
    await dialog.getByLabel("Row 1 tag").fill(TAG_A);
    await dialog.getByLabel("Row 1 model").fill(`E2E Laptop ${STAMP}`);
    await dialog.getByLabel("Row 1 specifications").fill("16GB / 512GB");
    await dialog.getByRole("button", { name: "Add another item" }).click();
    await ex(dialog.getByLabel("Row 2 model")).toHaveValue(`E2E Laptop ${STAMP}`);
    await ex(dialog.getByLabel("Row 2 specifications")).toHaveValue("16GB / 512GB");
    await dialog.getByLabel("Row 2 tag").fill(TAG_B);
    await dialog.getByRole("button", { name: "Add 2 items" }).click();
    await ex(dialog).toBeHidden();
    // Closing the dialog drops ?new=1, which re-renders the page; wait for it to settle.
    await ex(page).toHaveURL(/\/stock$/);
    await page.waitForLoadState("networkidle");
    await ex(row(page, TAG_A)).toBeVisible();
    await ex(row(page, TAG_B)).toBeVisible();
    await ex(page.locator(".toasts")).toContainText(`Added ${TAG_A}`);
    await ex(page.locator(".toasts")).toContainText("2 items");
    await clean("add stock");
  });

  await test.step("Stock: inline serial edit, search, check out one, export CSV", async () => {
    await page.getByRole("button", { name: `Edit serial number for ${TAG_A}` }).click();
    const input = page.getByLabel(`Serial number for ${TAG_A}`, { exact: true });
    await ex(input).toBeFocused();
    await input.fill(SERIAL);
    await ex(input).toHaveValue(SERIAL);
    // Wait for the save itself: reloading mid-request would cancel it.
    const saved = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/stock"),
    );
    await input.press("Enter");
    await saved;
    // The saved serial shows straight away, then survives a reload.
    await ex(row(page, TAG_A), "serial shown right after inline save").toContainText(SERIAL, {
      timeout: 4_000,
    });
    await page.reload();
    await ex(row(page, TAG_A)).toContainText(SERIAL);

    await page.goto(`/stock?q=${SERIAL}`);
    await ex(row(page, TAG_A)).toBeVisible();
    await ex(row(page, TAG_B)).toHaveCount(0);

    // Check out keeps the row: it moves to Deployed with who has it.
    await page.goto(`/stock?q=E2E-${SHORT}`);
    await row(page, TAG_B)
      .getByRole("button", { name: `Check out ${TAG_B}` })
      .click();
    const dialog = page.getByRole("dialog", { name: `Check out ${TAG_B}` });
    await ex(dialog.getByLabel("Issued to")).toBeFocused();
    await ex(dialog.getByLabel("Date")).toHaveValue(longDay(dubaiDate()));
    await dialog.getByRole("button", { name: "Check out", exact: true }).click();
    await ex(dialog.locator(".field-msg", { hasText: "who it is issued to" })).toBeVisible();
    await dialog.getByLabel("Issued to").fill(PERSON);
    await dialog.getByLabel("Note (optional)").fill("E2E handover");
    await dialog.getByRole("button", { name: "Check out", exact: true }).click();
    await ex(row(page, TAG_B)).toHaveCount(0);
    await ex(page.locator(".toasts")).toContainText(`Checked out ${TAG_B}`);
    await ex(row(page, TAG_A)).toBeVisible();

    const csv = await page.request.get("/stock/export");
    ex(csv.status()).toBe(200);
    const text = await csv.text();
    ex(text).toContain(TAG_A);
    ex(text).toContain(SERIAL);
    ex(text, "default export is the In stock list").not.toContain(TAG_B);
    const all = await (await page.request.get("/stock/export?view=all")).text();
    ex(all).toContain(TAG_B);
    ex(all).toContain(PERSON);

    await page.goto(`/stock?view=deployed&q=E2E-${SHORT}`);
    await ex(row(page, TAG_B)).toContainText(PERSON);
    await ex(row(page, TAG_A)).toHaveCount(0);
    await ex(page.locator(".seg a[aria-current='page']")).toContainText("Deployed");
    await page.goto(`/stock?view=all&q=E2E-${SHORT}`);
    await ex(row(page, TAG_A)).toBeVisible();
    await ex(row(page, TAG_B)).toBeVisible();

    // Check in returns it to the In stock list.
    await page.goto(`/stock?view=deployed&q=E2E-${SHORT}`);
    await row(page, TAG_B)
      .getByRole("button", { name: `Check in ${TAG_B}` })
      .click();
    const checkIn = page.getByRole("dialog", { name: `Check in ${TAG_B}?` });
    await checkIn.getByRole("button", { name: "Check in", exact: true }).click();
    await ex(row(page, TAG_B)).toHaveCount(0);
    // Wait for the save itself before reloading, or the reload can beat it.
    await ex(page.locator(".toasts")).toContainText(`Checked in ${TAG_B}`);
    await page.goto(`/stock?q=E2E-${SHORT}`);
    await ex(row(page, TAG_B)).toBeVisible();
    await ex(row(page, TAG_B)).not.toContainText(PERSON);
    await clean("stock check-out and in");
  });

  await test.step("Stock: column chooser hides a column and remembers it", async () => {
    await page.goto("/stock");
    await ex(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
    await page.getByRole("button", { name: "Choose columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Notes" }).click();
    await page.keyboard.press("Escape");
    await ex(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);
    await ex(page.getByRole("columnheader", { name: "Model" })).toBeVisible();
    await page.reload();
    await ex(
      page.getByRole("columnheader", { name: "Notes" }),
      "choice survives reload",
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Choose columns" }).click();
    await page.getByRole("menuitem", { name: "Show all columns" }).click();
    await page.keyboard.press("Escape");
    await ex(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
    await clean("column chooser");
  });

  await test.step("Stock: CSV import shows per-row problems, then imports in one go", async () => {
    await page.goto("/stock");
    await page.getByRole("button", { name: "Import CSV" }).click();
    const dialog = page.getByRole("dialog", { name: "Import stock from CSV" });
    const csv = (body: string) => ({
      name: "stock.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(body),
    });
    // A tag already on the list and a blank model are reported; nothing can be imported yet.
    await dialog
      .getByLabel("CSV file")
      .setInputFiles(
        csv(`Tag,Model,Serial number\n${TAG_C},E2E Dock,\n${TAG_A},Duplicate,\n${TAG_C}x,,\n`),
      );
    await ex(dialog.getByRole("list", { name: "Problems" })).toContainText(
      `Row 2: Tag ${TAG_A} is already on the stock list.`,
    );
    await ex(dialog.getByRole("list", { name: "Problems" })).toContainText("Row 3");
    await ex(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
    await page.goto(`/stock?q=E2E-${SHORT}`);
    await ex(row(page, TAG_C), "a failed preview wrote nothing").toHaveCount(0);

    await page.getByRole("button", { name: "Import CSV" }).click();
    await dialog
      .getByLabel("CSV file")
      .setInputFiles(
        csv(`Tag,Model,Serial number,Notes\n${TAG_C},E2E Dock,SN-C-${SHORT},imported\n`),
      );
    await dialog.getByRole("button", { name: "Import 1 item" }).click();
    await ex(dialog).toBeHidden();
    await ex(page.locator(".toasts")).toContainText("Imported 1 item");
    await ex(row(page, TAG_C)).toContainText("E2E Dock");
    await clean("stock import");
  });

  // ============================ 3. TASKS ============================
  await test.step("Tasks: quick-add with @due #PO !priority", async () => {
    await page.goto("/tasks");
    const box = page.getByRole("textbox", { name: "Quick add task" });
    await box.fill(`${TASK_TITLE} @tomorrow #${poNumber} !1`);
    await box.press("Enter");
    const r = row(page, TASK_TITLE);
    await ex(r).toBeVisible();
    await ex(r).toContainText(shortDay(dubaiDate(1)));
    await ex(r).toContainText("P1");
    await ex(r.getByRole("link", { name: poNumber })).toHaveAttribute("href", new RegExp(poNumber));
    await clean("quick add");
  });

  await test.step("Tasks: N opens the New task dialog, with validation and a related record", async () => {
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.locator("main h1").click();
    await page.keyboard.press("n");
    await ex(page).toHaveURL(/\/tasks\?new=1/);
    const dialog = page.getByRole("dialog", { name: "New task" });
    await ex(dialog).toBeVisible();
    // Defaults: P2 and Open.
    await ex(dialog.getByLabel("Priority")).toHaveValue("2");
    await ex(dialog.getByLabel("Status")).toHaveValue("open");
    // Title is required.
    await dialog.getByRole("button", { name: "Add task" }).click();
    await ex(dialog.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");
    await ex(dialog.getByLabel("Title")).toBeFocused();
    await ex(dialog.locator(".field-msg", { hasText: "Give the task a title" })).toBeVisible();
    // A related record must be one of the existing ones.
    await dialog.getByLabel("Title").fill(DIALOG_TASK);
    await dialog.getByLabel(/^Related record/).fill("no such record");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await ex(dialog.locator(".field-msg", { hasText: "Pick a record" })).toBeVisible();
    // The footer buttons sit on the right: Cancel, then the action.
    const cancel = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
    const add = await dialog.getByRole("button", { name: "Add task" }).boundingBox();
    ex(add!.x, "Cancel comes before the primary action").toBeGreaterThan(cancel!.x);
    ex(add!.x + add!.width, "buttons are right-aligned").toBeGreaterThan(
      (await dialog.boundingBox())!.x + (await dialog.boundingBox())!.width - 40,
    );
    await dialog.getByLabel(/^Related record/).fill(`${poNumber} · ${VENDOR}`);
    await dialog.getByLabel("Due date").fill(dubaiDate(3));
    await dialog.getByLabel("Priority").selectOption("1");
    await dialog.getByRole("button", { name: "Add task" }).click();
    await ex(dialog).toBeHidden();
    await ex(page).not.toHaveURL(/new=1/);
    const r = row(page, DIALOG_TASK);
    await ex(r).toBeVisible();
    await ex(r).toContainText("P1");
    await ex(r).toContainText(shortDay(dubaiDate(3)));
    await ex(r.getByRole("link", { name: poNumber })).toHaveAttribute("href", new RegExp(poNumber));
    await ex(page.locator(".toasts")).toContainText("Task added");

    // The top-bar New button opens the same dialog; ?new=1 works on a direct visit too.
    await page.getByRole("button", { name: /^New task/ }).click();
    await ex(page.getByRole("dialog", { name: "New task" })).toBeVisible();
    await page
      .getByRole("dialog", { name: "New task" })
      .getByRole("button", { name: "Cancel" })
      .click();
    await ex(page.getByRole("dialog", { name: "New task" })).toBeHidden();
    await page.goto("/tasks?new=1");
    await ex(page.getByRole("dialog", { name: "New task" })).toBeVisible();
    await page.keyboard.press("Escape");
    await ex(page.getByRole("dialog", { name: "New task" })).toBeHidden();

    // Remove what this step made.
    await r.getByRole("button", { name: /^Edit “/ }).click();
    await page
      .getByRole("dialog", { name: "Edit task" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: /^Delete “/ })
      .getByRole("button", { name: "Delete task" })
      .click();
    await ex(row(page, DIALOG_TASK)).toHaveCount(0);
    await clean("new task dialog");
  });

  await test.step("Tasks: tick -> Done view, untick, edit, delete", async () => {
    // The checkbox is optimistic and the row leaves the view on refresh, so click (not check()).
    await row(page, TASK_TITLE).getByRole("checkbox", { name: /done$/ }).click();
    await ex(row(page, TASK_TITLE)).toHaveCount(0, { timeout: 15_000 }); // left the Open view
    await page.goto("/tasks?view=done");
    await ex(row(page, TASK_TITLE)).toBeVisible();
    await row(page, TASK_TITLE)
      .getByRole("checkbox", { name: /not done$/ })
      .click();
    await ex(row(page, TASK_TITLE)).toHaveCount(0, { timeout: 15_000 });
    await page.goto("/tasks");
    await ex(row(page, TASK_TITLE)).toBeVisible();

    // Select the row and press E.
    await row(page, TASK_TITLE).getByText(TASK_TITLE).click();
    await page.keyboard.press("e");
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await ex(dialog).toBeVisible();
    await dialog.getByLabel("Task").fill(`${TASK_TITLE} edited`);
    await dialog.getByLabel("Priority").selectOption("3");
    await dialog.getByLabel("Status").selectOption("in_progress");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await ex(dialog).toBeHidden();
    const edited = row(page, `${TASK_TITLE} edited`);
    await ex(edited).toContainText("P3");
    await ex(edited).toContainText("In progress");

    // Delete asks first, with Cancel focused; Undo in the toast brings the task back.
    await edited.getByText(`${TASK_TITLE} edited`).click();
    await page.keyboard.press("e");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: /^Delete “/ });
    await ex(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Delete task" }).click();
    await ex(dialog).toBeHidden();
    await ex(row(page, TASK_TITLE)).toHaveCount(0);
    const toast = page.locator(".toasts .toast", { hasText: "Deleted" });
    await ex(toast).toContainText(`${TASK_TITLE} edited`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await ex(row(page, `${TASK_TITLE} edited`)).toContainText("P3");
    await ex(row(page, `${TASK_TITLE} edited`)).toContainText("In progress");

    // The per-row Edit button opens the same dialog; delete for real this time.
    await row(page, `${TASK_TITLE} edited`)
      .getByRole("button", { name: /^Edit “/ })
      .click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await confirm.getByRole("button", { name: "Delete task" }).click();
    await ex(dialog).toBeHidden();
    await ex(row(page, TASK_TITLE)).toHaveCount(0);
    await clean("tasks");
  });

  await test.step("Tasks: filter, sort, tabs with counts, bulk actions and Related (B-09, B-15, B-16, B-23, B-26)", async () => {
    const A = `E2E bulk A ${STAMP}`;
    const B = `E2E bulk B ${STAMP}`;
    await page.goto("/tasks");
    const box = page.getByRole("textbox", { name: "Quick add task" });
    await box.fill(`${A} !1`);
    await box.press("Enter");
    await ex(row(page, A)).toBeVisible();
    await box.fill(B);
    await box.press("Enter");
    await ex(row(page, B)).toBeVisible();

    // Filter: kept in ?q=, the tabs count only what matches, the list has no inner scroller.
    await page.goto("/tasks");
    await page.getByLabel("Filter tasks").fill(`E2E bulk ${STAMP}`);
    await ex(page).toHaveURL(/[?&]q=/);
    await ex(row(page, A)).toBeVisible();
    await ex(row(page, B)).toBeVisible();
    await ex(
      page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: /^Open/ }),
    ).toContainText("2");
    await ex(
      page.getByRole("navigation", { name: "Show" }).getByRole("link", { name: /^Done/ }),
    ).toContainText("0");
    const scroller = await page
      .locator(".tw")
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
      });
    ex(scroller.maxHeight, "the table has no height cap").toBe("none");
    ex(["visible", "clip"], "the table is not a scroll container").toContain(scroller.overflowY);

    // Sort by priority, high first inside the group: A (P1) before B (P2); reversed: B first.
    const order = async () =>
      (await page.getByRole("row").filter({ hasText: `E2E bulk` }).allInnerTexts()).map((t) =>
        t.includes(A) ? "A" : "B",
      );
    await page.goto(`/tasks?q=${encodeURIComponent(`E2E bulk ${STAMP}`)}&sort=priority`);
    await ex(row(page, A)).toBeVisible();
    ex(await order()).toEqual(["A", "B"]);
    await page.goto(`/tasks?q=${encodeURIComponent(`E2E bulk ${STAMP}`)}&sort=-priority`);
    await ex(row(page, A)).toBeVisible();
    ex(await order()).toEqual(["B", "A"]);

    // Bulk: select both, set priority (Undo), mark done (Undo).
    await page.goto(`/tasks?q=${encodeURIComponent(`E2E bulk ${STAMP}`)}`);
    await row(page, A)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await row(page, B)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    const bar = page.getByRole("group", { name: "Selected tasks" });
    await ex(bar).toContainText("2 selected");
    await bar.getByRole("button", { name: "Set priority" }).click();
    const prio = page.getByRole("dialog", { name: /^Set priority for 2 tasks/ });
    await prio.getByLabel("Priority").selectOption("3");
    await prio.getByRole("button", { name: "Apply" }).click();
    await ex(prio).toBeHidden();
    await ex(row(page, A)).toContainText("P3");
    await ex(row(page, B)).toContainText("P3");
    await page
      .locator(".toasts .toast", { hasText: "Priority set to P3" })
      .getByRole("button", { name: "Undo" })
      .click();
    await ex(row(page, A)).toContainText("P1");
    await ex(row(page, B)).toContainText("P2");

    await row(page, A)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await row(page, B)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await bar.getByRole("button", { name: "Mark done" }).click();
    await ex(row(page, A)).toHaveCount(0, { timeout: 15_000 }); // left the Open view
    await page
      .locator(".toasts .toast", { hasText: "Marked done for 2 tasks" })
      .getByRole("button", { name: "Undo" })
      .click();
    await ex(row(page, A)).toBeVisible();
    await ex(row(page, B)).toBeVisible();

    // Related (B-23): link A to the PO from the Edit dialog, then clear it.
    await row(page, A)
      .getByRole("button", { name: /^Edit “/ })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit task" });
    await ex(edit.locator("datalist option").first()).toBeAttached();
    await edit.getByLabel(/^Related/).fill(`${poNumber} · ${VENDOR}`);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await ex(edit).toBeHidden();
    await ex(row(page, A).getByRole("link", { name: poNumber })).toHaveAttribute(
      "href",
      new RegExp(poNumber),
    );
    await row(page, A)
      .getByRole("button", { name: /^Edit “/ })
      .click();
    await ex(edit.getByLabel(/^Related/)).toHaveValue(poNumber);
    await edit.getByRole("button", { name: "Clear" }).click();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await ex(edit).toBeHidden();
    await ex(row(page, A).getByRole("link", { name: poNumber })).toHaveCount(0);

    // Bulk delete asks first and Undo brings both back; then delete for real.
    await row(page, A)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await row(page, B)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await bar.getByRole("button", { name: /^Delete/ }).click();
    const del = page.getByRole("dialog", { name: "Delete 2 tasks?" });
    await ex(del.getByRole("button", { name: "Cancel" })).toBeFocused();
    await del.getByRole("button", { name: "Delete", exact: true }).click();
    await ex(row(page, A)).toHaveCount(0);
    await page
      .locator(".toasts .toast", { hasText: "Deleted 2 tasks" })
      .getByRole("button", { name: "Undo" })
      .click();
    await ex(row(page, A)).toBeVisible();
    await ex(row(page, B)).toBeVisible();
    await row(page, A)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await row(page, B)
      .getByRole("checkbox", { name: /^Select/ })
      .check();
    await bar.getByRole("button", { name: /^Delete/ }).click();
    await del.getByRole("button", { name: "Delete", exact: true }).click();
    await ex(row(page, A)).toHaveCount(0);
    await ex(row(page, B)).toHaveCount(0);
    await clean("tasks bulk");
  });

  // ======================== 4. SUBSCRIPTIONS ========================
  let subPanel: Locator;
  await test.step("Subscriptions: create monthly subscription", async () => {
    await page.goto("/subscriptions?new=1");
    const dialog = page.getByRole("dialog", { name: "New subscription" });
    await dialog.getByLabel("Name", { exact: true }).fill(SUB_NAME);
    await dialog.getByLabel("Vendor", { exact: true }).fill(VENDOR);
    await dialog.getByLabel("Plan", { exact: true }).fill("Pro");
    await dialog.getByLabel("Seats").fill("5");
    await dialog.getByLabel("User", { exact: true }).fill("E2E User");
    await dialog.getByLabel("Project", { exact: true }).fill("E2E Project");
    await dialog.getByLabel("Billing").selectOption("monthly");
    await dialog.getByLabel("Expected cost").fill("120");
    await dialog.getByRole("button", { name: "Create subscription" }).click();
    await ex(page).toHaveURL(/[?&]sub=[0-9a-f-]{36}/);
    await ex(row(page, SUB_NAME)).toBeVisible();
    subPanel = page.getByRole("complementary", { name: `${SUB_NAME} detail` });
    await ex(subPanel).toContainText("5 seats");
    await clean("create subscription");
  });

  await test.step("Subscriptions: the tiered-seats switch drops Plan and Seats (nothing saved)", async () => {
    const back = page.url(); // the E2E subscription is open here; later steps use its panel
    await page.goto("/subscriptions?new=1");
    const dialog = page.getByRole("dialog", { name: "New subscription" });
    await ex(dialog.getByLabel("Seats", { exact: true })).toBeVisible();
    await dialog.getByRole("switch", { name: "Standard / Premium seats" }).check();
    await ex(dialog.getByLabel("Seats", { exact: true })).toHaveCount(0);
    await ex(dialog.getByLabel("Plan", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await ex(dialog).toBeHidden();
    await page.goto(back);
    await ex(subPanel).toBeVisible();
    await clean("tiered seats switch");
  });

  await test.step("Subscriptions: auto-renew toggle persists after reload", async () => {
    const sw = subPanel.getByRole("switch", { name: "Auto-renew" });
    await ex(sw).toBeChecked();
    await sw.uncheck();
    await ex(sw).not.toBeChecked();
    await ex(sw, "focus stays on the switch after saving").toBeFocused();
    await ex(subPanel.getByText("Off", { exact: true })).toBeVisible();
    // The toast announces it and Undo flips it back.
    const toast = page.locator(".toasts .toast", { hasText: "Auto-renew off" });
    await toast.getByRole("button", { name: "Undo" }).click();
    await ex(sw).toBeChecked();
    // While a save is in flight the switch says so (aria-busy) and ignores clicks.
    await ex(sw).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await sw.uncheck();
    await ex(sw).not.toBeChecked();
    await ex(sw).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await page.reload();
    await ex(subPanel.getByRole("switch", { name: "Auto-renew" })).not.toBeChecked();
    await clean("auto-renew");
  });

  await test.step("Subscriptions: add invoice with a file", async () => {
    await subPanel.getByRole("button", { name: "Add invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "Add invoice" });
    await dialog.getByLabel("Charge date").fill(dubaiDate(-75));
    await dialog.getByLabel("Invoice number").fill(`INV-${SHORT}`);
    await dialog.getByLabel("File").setInputFiles(pdf("e2e-sub-invoice.pdf"));
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await ex(dialog).toBeHidden();
    const ledger = subPanel.getByRole("table", { name: "Invoice ledger" });
    await ex(ledger.getByRole("row").filter({ hasText: `INV-${SHORT}` })).toContainText("On file");
    const view = ledger.getByRole("link", { name: /^View invoice/ }).first();
    const res = await page.request.get((await view.getAttribute("href"))!, { maxRedirects: 0 });
    ex.soft([302, 303, 307, 308], "subscription invoice View link").toContain(res.status());
    // Subscription invoices are named Name_Subscription_[User]_Invoice_YYYY-MM (the billing period);
    // the user wins over the project.
    const named = await page.request.get(`${await view.getAttribute("href")}?download`, {
      maxRedirects: 0,
    });
    ex.soft(named.headers()["location"] ?? "", "subscription invoice download name").toContain(
      `/INV-${SHORT}_${SUB_SLUG}_Subscription_E2E-User_Invoice_${dubaiDate(-75).slice(0, 7)}.pdf?download`,
    );
    await clean("add invoice");
  });

  await test.step("Subscriptions: ledger icon buttons have labels and tooltips", async () => {
    const ledger = subPanel.getByRole("table", { name: "Invoice ledger" });
    const line = ledger.getByRole("row").filter({ hasText: `INV-${SHORT}` });
    const buttons = [
      [line.getByRole("link", { name: /^View invoice/ }), "View"],
      [line.getByRole("button", { name: /^Change invoice/ }), "Change"],
      [line.getByRole("link", { name: /^Download invoice/ }), "Download"],
    ] as const;
    for (const [control, text] of buttons) {
      await control.focus();
      await ex(
        page.getByRole("tooltip").filter({ hasText: text }).first(),
        `${text} tooltip on focus`,
      ).toBeVisible();
    }
    await buttons[0][0].hover();
    await ex(page.getByRole("tooltip").filter({ hasText: "View" }).first()).toBeVisible();
    // No horizontal scroll in the panel.
    const overflow = await subPanel.evaluate((el) => el.scrollWidth - el.clientWidth);
    ex.soft(overflow, "panel horizontal overflow").toBeLessThanOrEqual(1);
    await clean("ledger icons");
  });

  await test.step("Subscriptions: changing the User renames earlier downloads", async () => {
    await subPanel.getByRole("button", { name: /^Edit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await dialog.getByLabel("User", { exact: true }).fill("Test");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await ex(dialog).toBeHidden();
    const ledger = subPanel.getByRole("table", { name: "Invoice ledger" });
    const line = ledger.getByRole("row").filter({ hasText: `INV-${SHORT}` });
    const href = (await line
      .getByRole("link", { name: /^Download invoice/ })
      .getAttribute("href"))!;
    const res = await page.request.get(href, { maxRedirects: 0 });
    ex(res.headers()["location"] ?? "", "download name after changing the user").toContain(
      `/INV-${SHORT}_${SUB_SLUG}_Subscription_Test_Invoice_${dubaiDate(-75).slice(0, 7)}.pdf?download`,
    );
    await clean("rename on user change");
  });

  await test.step("Subscriptions: add a pro-rated invoice with a file", async () => {
    await subPanel.getByRole("button", { name: "Add invoice" }).click();
    const dialog = page.getByRole("dialog", { name: "Add invoice" });
    await ex(dialog.getByRole("button", { name: "Monthly renewal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ex(dialog.getByLabel("User", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Pro-rated" }).click();
    await dialog.getByLabel("Charge date").fill(dubaiDate(-74));
    await ex(dialog.getByLabel(/^Amount/)).toHaveValue("");
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await ex(dialog.getByText("Enter the person.")).toBeVisible();
    await dialog.getByLabel("Seat 1 person").fill("Sara Pro");
    await dialog.getByLabel(/^Amount/).fill("33");
    await dialog.getByLabel("Invoice number").fill(`PR-${SHORT}`);
    await dialog.getByLabel("File").setInputFiles(pdf("e2e-prorated.pdf"));
    await dialog.getByRole("button", { name: "Add invoice" }).click();
    await ex(dialog).toBeHidden();
    const ledger = subPanel.getByRole("table", { name: "Invoice ledger" });
    const line = ledger.getByRole("row").filter({ hasText: `PR-${SHORT}` });
    await ex(line).toContainText("Pro-rated ·");
    await ex(line).toContainText("+1 Standard");
    await ex(line).toContainText("On file");
    // The seats open under the line.
    const toggle = line.getByRole("button", { name: /^Pro-rated/ });
    await ex(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await ex(toggle).toHaveAttribute("aria-expanded", "true");
    await ex(ledger.getByRole("table", { name: /^Seats on the/ })).toContainText("Sara Pro");
    // Same month as the renewal row, which is still there.
    await ex(ledger.getByRole("row").filter({ hasText: `INV-${SHORT}` })).toBeVisible();
    const href = (await line
      .getByRole("link", { name: /^Download invoice/ })
      .getAttribute("href"))!;
    const res = await page.request.get(href, { maxRedirects: 0 });
    ex(res.headers()["location"] ?? "", "pro-rated download name").toContain(
      `/PR-${SHORT}_${SUB_SLUG}_Subscription_Sara-Pro_Pro-rated_Invoice_${dubaiDate(-74)}.pdf?download`,
    );
    const overflow = await subPanel.evaluate((el) => el.scrollWidth - el.clientWidth);
    ex.soft(overflow, "panel horizontal overflow").toBeLessThanOrEqual(1);
    await clean("pro-rated invoice");
  });

  await test.step("Subscriptions: edit seats, export CSV", async () => {
    await subPanel.getByRole("button", { name: /^Edit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await dialog.getByLabel("Seats").fill("8");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await ex(dialog).toBeHidden();
    await ex(subPanel).toContainText("8 seats");
    const csv = await page.request.get("/subscriptions/export");
    ex(csv.status()).toBe(200);
    ex(await csv.text()).toContain(SUB_NAME);
    await clean("edit subscription");
  });

  await test.step("Subscriptions: no notice period field; Due-this-month filter", async () => {
    await subPanel.getByRole("button", { name: /^Edit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await ex(dialog).toContainText("A recurring charge or a fixed-term contract");
    await ex(dialog.getByLabel("Notice period (days)")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await ex(dialog).toBeHidden();
    await ex(subPanel.getByText("Cancel by", { exact: true })).toHaveCount(0);
    // The dashboard link lands on the month it counted.
    await page.goto("/subscriptions?due=month");
    await ex(page.getByRole("link", { name: /^Due in \w+/ })).toBeVisible();
    await ex(row(page, SUB_NAME)).toBeVisible();
    await page.goto("/subscriptions?due=bogus");
    await ex(page.getByRole("link", { name: /^Due in \w+/ })).toHaveCount(0);
    await clean("due filter");
  });

  const IMPORT_NAME = `E2E Import ${STAMP}`;
  await test.step("Subscriptions: CSV import validates every row, then imports", async () => {
    await page.goto("/subscriptions");
    await page.getByRole("button", { name: "Import CSV" }).click();
    const dialog = page.getByRole("dialog", { name: "Import subscriptions from CSV" });
    const csv = (rows: string[]) => ({
      name: "subs.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        ["Name,Vendor,Kind,Billing,Expected cost,Currency,Next charge,Auto-renew", ...rows].join(
          "\n",
        ) + "\n",
      ),
    });
    const file = dialog.getByLabel("CSV file");
    // A duplicate of an existing record and a bad date are rejected per row; nothing imports.
    await file.setInputFiles(
      csv([
        `${SUB_NAME},${VENDOR},Subscription,Monthly,10,AED,${dubaiDate(30)},Yes`,
        `${IMPORT_NAME},${VENDOR},Subscription,Monthly,10,AED,13/10/2026,Yes`,
      ]),
    );
    await ex(dialog.getByLabel("Problems")).toContainText("already recorded");
    await ex(dialog.getByLabel("Problems")).toContainText("Next charge");
    await ex(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
    await file.setInputFiles(
      csv([`${IMPORT_NAME},${VENDOR},Subscription,Monthly,10,USD,${dubaiDate(30)},Yes`]),
    );
    await ex(dialog).toContainText("no problems found");
    await dialog.getByRole("button", { name: "Import 1 subscription" }).click();
    await ex(dialog).toBeHidden();
    await ex(row(page, IMPORT_NAME)).toBeVisible();
    await clean("import subscriptions");
  });

  await test.step("Subscriptions: a renewal alert and a labelled strip mark (B-07, B-08)", async () => {
    // The imported plan renews in 30 days; make it yearly so it shows on the strip.
    await page.goto(`/subscriptions?q=${encodeURIComponent(IMPORT_NAME)}`);
    await row(page, IMPORT_NAME).first().click();
    const panel = page.getByRole("complementary", { name: `${IMPORT_NAME} detail` });
    await panel.getByRole("button", { name: /^Edit/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await dialog.getByLabel("Billing").selectOption("yearly");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await ex(dialog).toBeHidden();

    await page.goto("/subscriptions");
    await ex(
      page
        .getByTestId("strip-label")
        .filter({ hasText: IMPORT_NAME })
        // Real marks on the same day fold into a count bubble that lists the names.
        .or(page.getByRole("group", { name: new RegExp(IMPORT_NAME) })),
      "strip shows the name beside the dot, or in a count bubble",
    ).toBeVisible();

    await page.goto("/");
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const alertRow = page.getByTestId("alert-row").filter({ hasText: `${IMPORT_NAME} renews in` });
    await ex(alertRow).toContainText("renews in 30 days");
    await ex(alertRow.getByRole("link")).toHaveAttribute("href", /\/subscriptions\?sub=/);
    if (process.env.E2E_SHOT_DIR)
      await page
        .getByRole("dialog", { name: "Notifications" })
        .or(page.locator("[aria-label='Notifications'][data-state='open']"))
        .first()
        .screenshot({ path: `${process.env.E2E_SHOT_DIR}/bell-renewal.png` });
    await alertRow.getByRole("button", { name: /^Dismiss/ }).click();
    await ex(alertRow).toHaveCount(0);
    await page.keyboard.press("Escape");
    await clean("renewal alert + strip labels");
  });

  // ====================== 5. ON / OFFBOARDING ======================
  let checklistId = "";
  await test.step("Onboarding: new checklist for a new person with template items", async () => {
    await page.goto("/onboarding?new=1");
    const dialog = page.getByRole("dialog", { name: "New checklist" });
    await ex(dialog.getByLabel("Type")).toHaveValue("onboarding");
    await dialog.getByLabel("Full name").fill(PERSON);
    await dialog.getByLabel("Department").fill("IT");
    await dialog.getByLabel("Manager").fill("E2E Manager");
    await dialog.getByRole("button", { name: "Create checklist" }).click();
    await ex(page).toHaveURL(/[?&]checklist=[0-9a-f-]{36}/);
    checklistId = /checklist=([0-9a-f-]{36})/.exec(page.url())![1]!;
    await ex(page.locator("main h2.h1")).toHaveText(PERSON);
    await ex(
      page.getByRole("link", { name: new RegExp(PERSON) }).filter({ hasText: "Onboarding" }),
    ).toBeVisible();
    for (const label of ["Issue equipment", "Create email account", "Set up VPN and remote access"])
      await ex(page.getByText(label, { exact: true })).toBeVisible();
    await clean("new checklist");
  });

  await test.step("Onboarding: equipment sub-items, ticking completes the parent", async () => {
    const add = page.getByLabel("Add equipment under Issue equipment");
    await add.fill("E2E Laptop");
    await add.press("Enter");
    await ex(page.getByText("E2E Laptop", { exact: true })).toBeVisible();
    await add.fill("E2E Charger");
    await add.press("Enter");
    await ex(page.getByText("E2E Charger", { exact: true })).toBeVisible();

    const parent = page.getByRole("checkbox", { name: "Done: Issue equipment" });
    await ex(parent).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Done: E2E Laptop" }).check();
    await ex(page.getByRole("checkbox", { name: "Done: E2E Laptop" })).toBeChecked();
    await ex(parent).not.toBeChecked();
    await page.getByRole("checkbox", { name: "Done: E2E Charger" }).check();
    await ex(parent).toBeChecked({ timeout: 15_000 });
    // B-21: the Equipment heading counts pieces, not the one parent row.
    await ex(page.locator(".group-head", { hasText: "Equipment" }).first()).toContainText(
      "2 / 2 pieces",
    );
    await clean("equipment");
  });

  await test.step("Onboarding: not applicable, edit, remove, add item", async () => {
    // Not applicable
    await page.getByRole("button", { name: "More for Create email account" }).click();
    await page.getByRole("menuitem", { name: "Not applicable" }).click();
    await ex(page.getByRole("checkbox", { name: "Done: Create email account" })).toBeDisabled();
    await ex(page.locator(".it.na")).toContainText("Not applicable");

    // Edit
    await page.getByRole("button", { name: "More for Add to team chat and shared drives" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit item" });
    await edit.getByLabel("Item").fill("Add to team chat and shared drives (edited)");
    await edit.getByLabel("Detail").fill("E2E detail");
    await edit.getByRole("button", { name: "Save" }).click();
    await ex(edit).toBeHidden();
    await ex(page.getByText("Add to team chat and shared drives (edited)")).toBeVisible();
    await ex(page.getByText("E2E detail")).toBeVisible();

    // Remove: the shared confirm dialog (Cancel focused), then Undo restores the item.
    await page.getByRole("button", { name: "More for Set up VPN and remote access" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    const confirm = page.getByRole("dialog", { name: /^Remove “Set up VPN and remote access”\?/ });
    await ex(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Remove item" }).click();
    await ex(page.getByText("Set up VPN and remote access", { exact: true })).toHaveCount(0);
    await page
      .locator(".toasts .toast", { hasText: "Removed" })
      .getByRole("button", { name: "Undo" })
      .click();
    await ex(page.getByText("Set up VPN and remote access", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "More for Set up VPN and remote access" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await confirm.getByRole("button", { name: "Remove item" }).click();
    await ex(page.getByText("Set up VPN and remote access", { exact: true })).toHaveCount(0);

    // Add item via the header button
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add item" });
    await add.getByLabel("Item").fill("E2E extra item");
    await add.getByRole("button", { name: "Add item" }).click();
    await ex(add).toBeHidden();
    await ex(page.getByText("E2E extra item", { exact: true })).toBeVisible();
    await clean("item edits");
  });

  await test.step("Onboarding: handover form renders; open items are in Tasks", async () => {
    const res = await page.goto(`/handover/${checklistId}`);
    // Soft: if the page 500s, report it but still check the Tasks part below.
    ex.soft(res?.status(), "GET /handover/{id}").toBeLessThan(400);
    if (res && res.status() < 400) {
      await ex(page.getByRole("heading", { level: 1 })).toHaveText(PERSON);
      await ex(page.getByText(/Onboarding . equipment handover/)).toBeVisible();
      await ex(page.getByText("Equipment issued")).toBeVisible();
      await ex(page.getByText("E2E Laptop")).toBeVisible();
      // B-20: header block, handover date line, retitled accounts, footer.
      await ex(page.getByText(/Equipment handover form . Ref /)).toBeVisible();
      await ex(page.getByText("Handover date").first()).toBeVisible();
      await ex(page.getByText("Accounts set up")).toBeVisible();
      await ex(page.locator("footer")).toContainText("IT equipment handover");
    }

    await page.goto("/tasks");
    await ex(row(page, `— ${PERSON}`).first()).toBeVisible();
    await ex(row(page, `Add to team chat and shared drives (edited) — ${PERSON}`)).toBeVisible();
    await ex(row(page, `E2E extra item — ${PERSON}`)).toBeVisible();
    await clean("handover + tasks");
  });

  await test.step("Offboarding: items without a due date get the last day (new checklist and added item)", async () => {
    const lastDay = dubaiDate(30);
    await page.goto("/onboarding?new=1");
    const dialog = page.getByRole("dialog", { name: "New checklist" });
    await dialog.getByLabel("Type").selectOption("offboarding");
    await dialog.getByLabel("Person").selectOption({ label: `${PERSON} \u00B7 IT` });
    await ex(dialog.getByText("Last day", { exact: true })).toBeVisible();
    await dialog.getByLabel("Last day").fill(lastDay);
    await ex(dialog.getByText(/Items without a due date use the last day/)).toBeVisible();
    // One item gets its own date; the rest are left blank.
    await dialog.getByLabel("Due date for Revoke VPN and remote access").fill(dubaiDate(10));
    await dialog.getByRole("button", { name: "Create checklist" }).click();
    await ex(page).toHaveURL(/[?&]checklist=[0-9a-f-]{36}/);
    await ex(page.locator("main h2.h1")).toHaveText(PERSON);

    // Add an item and clear the pre-filled date: it still ends up on the last day.
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add item" });
    await add.getByLabel("Item").fill("E2E offboard extra");
    await add.getByLabel("Due").fill("");
    await add.getByRole("button", { name: "Add item" }).click();
    await ex(add).toBeHidden();
    await ex(page.getByText("E2E offboard extra", { exact: true })).toBeVisible();

    await page.goto("/tasks");
    const due = (title: string) =>
      row(page, `${title} \u2014 ${PERSON}`).filter({ hasText: "Offboarding" });
    await ex(due("Remove from team chat and shared drives")).toContainText(shortDay(lastDay));
    await ex(due("Collect equipment")).toContainText(shortDay(lastDay));
    await ex(due("E2E offboard extra")).toContainText(shortDay(lastDay));
    await ex(due("Revoke VPN and remote access")).toContainText(shortDay(dubaiDate(10)));
    // Source says just "Offboarding" because Related already names the person (B-29).
    await ex(due("Collect equipment").locator("[data-col=source]")).toHaveText("Offboarding");
    await clean("offboarding default date");
  });

  // ========================= 6. ACTIVITY LOG =========================
  await test.step("Activity log: actions appear as sentences; filters and CSV", async () => {
    await page.goto("/activity?range=today");
    const filter = page.getByRole("textbox", { name: "Filter by record" });
    await filter.fill(poNumber);
    await ex(page).toHaveURL(new RegExp(`q=${poNumber}`));
    const table = page.getByRole("table", { name: "Activity" });
    await ex(table).toContainText(`Created ${poNumber}`);
    await ex(table).toContainText(`Moved ${poNumber} to Approved`);
    await ex(table).toContainText(`Moved ${poNumber} to Closed`);
    // Attachments are logged under the file name (the record search matches record names).
    const approvalFile = `${PO_SLUG}_Approval_${dubaiDate()}.pdf`;
    await page.goto(`/activity?range=today&q=${approvalFile}`);
    await ex(page.getByRole("table", { name: "Activity" })).toContainText(
      `Attached approval file ${approvalFile} to ${poNumber}`,
    );

    await page.goto(`/activity?range=today&q=${encodeURIComponent(TASK_TITLE)}`);
    await ex(page.getByRole("table", { name: "Activity" })).toContainText("Created task");
    await ex(page.getByRole("table", { name: "Activity" })).toContainText("Deleted task");

    // B-28: a checklist item label is a bold span, not wrapped in curly quotes.
    await page.goto(`/activity?range=today&q=${encodeURIComponent("E2E Laptop")}`);
    const ticked = page.getByRole("table", { name: "Activity" }).getByText(/^Ticked E2E Laptop on/);
    await ex(ticked.first()).toBeVisible();
    await ex(page.getByRole("table", { name: "Activity" })).not.toContainText("“E2E Laptop");

    await page.goto(`/activity?range=today&q=${encodeURIComponent(SUB_NAME)}`);
    await ex(page.getByRole("table", { name: "Activity" })).toContainText(
      `Added subscription ${SUB_NAME}`,
    );

    await page.goto(`/activity?range=today&q=${encodeURIComponent(PERSON)}`);
    await ex(page.getByRole("table", { name: "Activity" })).toContainText(
      "Started onboarding checklist for",
    );

    // Module chip + stamped record search together (stock is deliberately not logged).
    await page.goto(`/activity?range=today&q=${encodeURIComponent(SUB_NAME)}`);
    const subRows = page.getByRole("table", { name: "Activity" }).getByRole("row");
    await ex(subRows.filter({ hasText: SUB_NAME }).first()).toBeVisible();
    await page
      .getByRole("navigation", { name: "Module" })
      .getByRole("link", { name: /^Subscriptions\s*\d+$/ })
      .click();
    await ex(page).toHaveURL(/module=Subscriptions/);
    await ex(subRows.filter({ hasText: SUB_NAME }).first()).toBeVisible();
    await ex(page.getByRole("table", { name: "Activity" })).not.toContainText(
      `Created ${poNumber}`,
    );

    // The owner is the only user: there is no Person filter, only Module and Date.
    await ex(page.locator(".fl .lab", { hasText: "Person" })).toHaveCount(0);
    await ex(page.locator(".fl .lab", { hasText: "Module" })).toBeVisible();
    await ex(page.locator(".fl .lab", { hasText: "Date" })).toBeVisible();
    await ex(page.getByRole("link", { name: "Everyone" })).toHaveCount(0);

    const csvSub = await page.request.get(
      `/activity/export?range=all&q=${encodeURIComponent(SUB_NAME)}`,
    );
    ex(csvSub.headers()["content-type"]).toContain("text/csv");
    ex(await csvSub.text()).toContain(SUB_NAME);
    await clean("activity");
  });

  await test.step("Subscriptions and Activity: filter, sort, tabs with counts (B-09, B-25, B-26)", async () => {
    await page.goto("/subscriptions");
    await page.locator("[data-filter]").fill(SUB_NAME);
    await ex(page).toHaveURL(/[?&]q=/);
    await ex(row(page, SUB_NAME)).toBeVisible();
    await ex(
      page.getByRole("navigation", { name: "Kind" }).getByRole("link", { name: /^All/ }),
    ).toContainText(/1 of \d+/);
    await ex(
      page.getByRole("navigation", { name: "Kind" }).getByRole("link", { name: /^Subscriptions/ }),
    ).toContainText("1");
    const csv = await page.request.get(`/subscriptions/export?q=${encodeURIComponent(SUB_NAME)}`);
    ex(csv.headers()["content-disposition"]).toContain("subscriptions-filtered");
    ex(await csv.text()).toContain(SUB_NAME);
    await page.goto("/subscriptions");
    await sortBy(page, "Last paid", "Last paid ↑");
    await ex(page).toHaveURL(/sort=-paid/);
    await ex(page).toHaveTitle(/^Subscriptions/);

    await page.goto("/activity");
    for (const group of ["Module", "Date"]) {
      const links = page.getByRole("navigation", { name: group }).getByRole("link");
      await ex(links.first()).toContainText(/\d/);
    }
    await ex(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
    await clean("subscriptions + activity lists");
  });

  // ======================= WORKFLOW BATCH 6 =======================
  await test.step("DateField, alerts bell, settings and dashboard order (B-07, B-10, B-11, B-12, B-13)", async () => {
    // B-11: dates are typed as "13 Oct 2026" (or day-first 13/10/2026) and shown the same way.
    await page.goto("/tasks?new=1");
    const dialog = page.getByRole("dialog", { name: "New task" });
    await dialog.getByLabel("Title").fill(ALERT_TASK);
    const due = dialog.getByLabel("Due date");
    const overdueIso = dubaiDate(-2);
    const [oy, om, od] = overdueIso.split("-");
    await due.fill(`${od}/${om}/${oy}`);
    await due.blur();
    await ex(due).toHaveValue(longDay(overdueIso));
    await due.fill("31 Feb 2026");
    await ex(due).toHaveAttribute("aria-invalid", "true");
    await due.fill(longDay(overdueIso));
    await ex(due).not.toHaveAttribute("aria-invalid", "true");
    // The calendar picks a day and shows it in the same format.
    await dialog.getByRole("button", { name: "Open calendar" }).click();
    await page.getByRole("button", { name: longDay(overdueIso), exact: true }).click();
    await ex(due).toHaveValue(longDay(overdueIso));
    await dialog.getByRole("button", { name: "Add task" }).click();
    await ex(dialog).toBeHidden();
    await ex(row(page, ALERT_TASK)).toContainText(shortDay(overdueIso));

    // B-07: the overdue task raises an alert; read state and dismissal are remembered.
    await page.goto("/");
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await ex(bell).toBeVisible();
    await bell.click();
    const alertRow = page.getByTestId("alert-row").filter({ hasText: ALERT_TASK });
    await ex(alertRow).toBeVisible();
    await ex(alertRow.getByRole("link")).toHaveAttribute("href", /\/tasks\?task=/);
    await alertRow.getByRole("button", { name: /^Dismiss/ }).click();
    await ex(alertRow).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await ex(page.getByTestId("alert-row").filter({ hasText: ALERT_TASK })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // B-10: settings (no Members), and the "?" shortcuts sheet.
    await page.goto("/settings");
    await ex(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await ex(page.getByText("Members", { exact: true })).toHaveCount(0);
    const original = {
      name: await page.getByLabel("Workspace name").inputValue(),
      rate: await page.getByLabel("USD to AED rate").inputValue(),
    };
    await page.getByLabel("Workspace name").fill(`E2E Desk ${SHORT}`);
    await page.getByLabel("USD to AED rate").fill("0");
    await page.getByRole("button", { name: "Save settings" }).click();
    await ex(page.locator(".field-msg", { hasText: "above zero" })).toBeVisible();
    await page.getByLabel("USD to AED rate").fill("3.7");
    await page.getByRole("button", { name: "Save settings" }).click();
    await ex(page.locator(".toasts")).toContainText("Settings saved");
    await page.reload();
    await ex(page.getByLabel("Workspace name")).toHaveValue(`E2E Desk ${SHORT}`);
    await ex(page).toHaveTitle(new RegExp(`E2E Desk ${SHORT}`));
    await page.getByLabel("Workspace name").fill(original.name);
    await page.getByLabel("USD to AED rate").fill(original.rate);
    await page.getByRole("button", { name: "Save settings" }).click();
    await ex(page.locator(".toasts")).toContainText("Settings saved");
    await page.goto("/tasks");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("?");
    await ex(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await ex(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();

    // B-13: Needs attention shows red before amber, at most 8 rows.
    await page.goto("/");
    const attention = page.getByRole("region", { name: "Needs attention" });
    const tones = await attention
      .locator(".att .st")
      .evaluateAll((els) => els.map((e) => (e.classList.contains("c-red") ? "red" : "amber")));
    ex(tones.length, "at most 8 rows").toBeLessThanOrEqual(8);
    ex(tones.join(","), "red rows come first").toBe(
      [...tones.filter((t) => t === "red"), ...tones.filter((t) => t !== "red")].join(","),
    );

    // Remove the task.
    await page.goto("/tasks");
    await row(page, ALERT_TASK)
      .getByRole("button", { name: /^Edit “/ })
      .click();
    await page
      .getByRole("dialog", { name: "Edit task" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: /^Delete “/ })
      .getByRole("button", { name: "Delete task" })
      .click();
    await ex(row(page, ALERT_TASK)).toHaveCount(0);
    await clean("batch 6");
  });

  await test.step("Settings: workspace name, logo, base currency and time zone (B-10)", async () => {
    await page.goto("/settings");
    await ex(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    // On Settings no module is highlighted in the sidebar.
    await ex(page.locator(".side a[aria-current='page']")).toHaveCount(0);

    const original = {
      name: await page.getByLabel("Workspace name").inputValue(),
      currency: await page.getByLabel("Base currency").inputValue(),
      zone: await page.getByLabel("Time zone").inputValue(),
      rate: await page.getByLabel(/^USD to .* rate$/).inputValue(),
    };
    const save = async () => {
      await page.getByRole("button", { name: "Save settings" }).click();
      await ex(page.locator(".toasts")).toContainText("Settings saved");
    };
    const logoPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const logoSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"><rect width="120" height="30" fill="#e5484d"/></svg>',
    );

    try {
      // --- name in the app bar, and on the login page for a signed-out visitor ---
      await page.getByLabel("Workspace name").fill(`E2E Desk ${SHORT}`);
      await save();
      await page.goto("/settings");
      await ex(page.locator("header.top .wordmark")).toContainText(`E2E Desk ${SHORT}`);
      const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
      const login = await visitor.newPage();
      await login.goto("/login");
      await ex(login.locator(".login-card")).toContainText(`E2E Desk ${SHORT}`);

      // --- logo: wrong type and size are refused; PNG and SVG show in the bar and login ---
      const file = page.getByTestId("logo-file");
      await file.setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: logoPng });
      await ex(page.locator(".alert.red")).toContainText("PNG, SVG or JPG");
      await file.setInputFiles({
        name: "big.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(1024 * 1024 + 1),
      });
      await ex(page.locator(".alert.red")).toContainText("1 MB");

      await file.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng });
      await ex(page.locator(".toasts")).toContainText("Logo updated");
      const barLogo = page.locator("header.top .wordmark img");
      await ex(barLogo).toHaveAttribute("src", /^\/brand\/logo\?v=logo-/);
      await ex(barLogo).toHaveClass(/custom-logo/);
      // Height-only sizing keeps the ratio; no recolouring filter.
      const css = await barLogo.evaluate((el) => {
        const c = getComputedStyle(el);
        return { filter: c.filter, width: c.width, height: c.height };
      });
      ex(css.filter).toBe("none");
      await login.reload();
      await ex(login.locator(".login-card img.custom-logo")).toHaveAttribute(
        "src",
        /\/brand\/logo/,
      );
      const served = await visitor.request.get("/brand/logo");
      ex(served.status()).toBe(200);
      ex(served.headers()["content-type"]).toBe("image/png");

      const pngSrc = await barLogo.getAttribute("src");
      await file.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: logoSvg });
      await ex(barLogo).not.toHaveAttribute("src", pngSrc!);
      const svg = await visitor.request.get("/brand/logo");
      ex(svg.headers()["content-type"]).toBe("image/svg+xml");
      ex(svg.headers()["content-security-policy"]).toContain("sandbox");

      await page.getByRole("button", { name: "Remove logo" }).click();
      await ex(page.locator(".toasts")).toContainText("Logo removed");
      await ex(page.locator("header.top .wordmark img")).not.toHaveClass(/custom-logo/);
      await ex(page.locator("header.top .wordmark img")).toHaveAttribute("src", "/brand/mark.svg");
      await ex(page.getByRole("button", { name: "Remove logo" })).toHaveCount(0);
      await visitor.close();

      // --- base currency: warning, rate label, money labels follow the setting ---
      await page.goto("/settings");
      await page.getByLabel("Base currency").selectOption("EUR");
      await ex(page.getByText("Amounts already saved are not converted")).toBeVisible();
      await ex(page.getByLabel("USD to EUR rate")).toBeVisible();
      await page.getByLabel("Base currency").selectOption("USD");
      await ex(page.getByLabel(/^USD to .* rate$/)).toHaveCount(0);
      await page.getByLabel("Base currency").selectOption("EUR");
      await save();
      await page.goto("/procurement");
      await ex(page.locator(".cur", { hasText: "EUR" }).first()).toBeVisible();
      await ex(page.locator(".cur", { hasText: "AED" })).toHaveCount(0);
      const csv = await page.request.get("/procurement/export");
      ex((await csv.text()).split(/\r?\n/)[0]).toContain("Total (EUR)");
      await page.goto("/subscriptions?new=1");
      await ex(page.getByLabel("Currency", { exact: true })).toHaveValue("EUR");

      // --- time zone: dates and times follow the zone. A zone behind Dubai is used, and the
      // Dashboard and Subscriptions are not opened in it, so no billing period can roll early. ---
      await page.goto("/settings");
      await page.getByLabel("Time zone").selectOption("Pacific/Pago_Pago");
      await save();
      const activityCsv = await page.request.get("/activity/export");
      ex((await activityCsv.text()).slice(0, 80)).toContain("Time (Pacific/Pago_Pago)");
      await page.goto("/activity");
      await ex(page.getByRole("heading", { level: 1 })).toHaveText("Activity log");
      await page.goto("/tasks");
      await ex(page.getByRole("heading", { level: 1 })).toBeVisible();
    } finally {
      await page.goto("/settings");
      await page.getByLabel("Base currency").selectOption(original.currency);
      await page.getByLabel("Time zone").selectOption(original.zone);
      await page.getByLabel("Workspace name").fill(original.name);
      const rate = page.getByLabel(/^USD to .* rate$/);
      if (await rate.count()) await rate.fill(original.rate);
      await page.getByRole("button", { name: "Save settings" }).click();
      await ex(page.locator(".toasts")).toContainText("Settings saved");
      const removeLogo = page.getByRole("button", { name: "Remove logo" });
      if (await removeLogo.count()) await removeLogo.click();
    }
    await page.reload();
    await ex(page.getByLabel("Base currency")).toHaveValue(original.currency);
    await ex(page.getByLabel("Time zone")).toHaveValue(original.zone);
    await ex(page.getByLabel("Workspace name")).toHaveValue(original.name);
    await clean("settings");
  });

  // ===================== Procurement totals =====================
  // Shared with e2e/focus/po-totals.spec.ts; creates and removes its own E2E purchase.
  await poTotalsSteps(page, (title, body) => test.step(title, body), STAMP);

  // ============================ Board ============================
  // Shared with e2e/focus/board.spec.ts; creates and removes its own note, file and task.
  await boardSteps(page, (title, body) => test.step(title, body), STAMP);

  // ============================ Delete ============================
  // Shared with e2e/focus/delete.spec.ts; creates its own E2E records and deletes them.
  await deleteSteps(page, (title, body) => test.step(title, body), STAMP);

  // ========================= Seat roster =========================
  // Shared with e2e/focus/seat-roster.spec.ts; uses its own "E2E Claude Code Team" row.
  await seatRosterSteps(page, (title, body) => test.step(title, body), STAMP);
  await page.setViewportSize({ width: 1280, height: 720 });

  // =========================== cleanup ===========================
  await test.step("Cleanup: retire the E2E stock items (stock is never hard-deleted)", async () => {
    await page.goto(`/stock?q=E2E-${SHORT}`);
    for (const tag of [TAG_A, TAG_B, TAG_C])
      await row(page, tag)
        .getByRole("checkbox", { name: `Select ${tag}` })
        .check();
    await page.getByRole("button", { name: "Retire", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Retire/ });
    await dialog.getByRole("button", { name: "Retire", exact: true }).click();
    await ex(row(page, TAG_A)).toHaveCount(0);
    // Wait for the save itself before navigating, or the next page can beat it.
    await ex(page.locator(".toasts")).toContainText("Retired 3 items");
    await page.goto(`/stock?view=retired&q=E2E-${SHORT}`);
    await ex(row(page, TAG_C)).toContainText("Retired");
    await clean("cleanup stock");
  });

  // ============================ 7. DASHBOARD ============================
  await test.step("Dashboard reflects the new data", async () => {
    await page.goto("/");
    await ex(page.getByRole("heading", { level: 1 })).toHaveText(/^Good /);
    ex(await statValue("In stock"), "stock returns to baseline after cleanup").toBe(baseline.stock);
    ex(await statValue("Renewals this month")).toBeGreaterThan(baseline.renewals);
    ex(await openTaskCount()).toBeGreaterThan(baseline.tasks);

    await page.goto("/");
    const renewals = page.getByRole("region", { name: "Upcoming renewals" });
    await ex(renewals.getByText(SUB_NAME)).toBeVisible();
    const win60 = renewals.getByRole("button", { name: "60 days" });
    await win60.click();
    await ex(win60).toHaveAttribute("aria-pressed", "true");
    await ex(renewals.getByText(/in the next 60 days/)).toBeVisible();
    await renewals.getByRole("button", { name: "90 days" }).click();
    await ex(renewals.getByText(/in the next 90 days/)).toBeVisible();
    await ex(renewals.getByText(SUB_NAME)).toBeVisible();

    const feed = page.getByRole("region", { name: "Recent activity" });
    await ex(feed.locator(".feed").first()).toBeVisible();
    await clean("dashboard");
  });
});
