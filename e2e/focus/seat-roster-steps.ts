import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * The seat roster, shared by the focused spec (e2e/focus/seat-roster.spec.ts) and the full
 * suite (e2e/workflows.spec.ts). Everything is "E2E …": the subscription is created directly
 * in the database with the `tiered_seats` flag (so no real name is saved), the person for the
 * offboarding step too; both are removed at the end. Real subscriptions are never touched.
 * Screenshots: set E2E_SHOT_DIR to a folder.
 */
const ex = expect.configure({ timeout: 15_000 });

const dubaiDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

async function shot(target: Page | Locator, name: string) {
  const dir = process.env.E2E_SHOT_DIR;
  if (dir) await target.screenshot({ path: `${dir}/${name}.png` });
}

export async function seatRosterSteps(
  page: Page,
  step: (title: string, body: () => Promise<void>) => Promise<void>,
  stamp: string,
) {
  const subName = `E2E Claude Code Team ${stamp}`;
  const vendorName = `E2E Seat Vendor ${stamp}`;
  const saraName = `E2E Sara ${stamp}`;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const email = (letter: string) => `e2e-${letter}-${stamp}@example.test`;
  let subId = "";
  let personId = "";
  try {
    // ---------------------------------------------------------------- set-up (E2E rows only)
    const { data: vendor, error: vErr } = await db
      .from("vendors")
      .insert({ name: vendorName })
      .select("id")
      .single();
    if (vErr) throw vErr;
    const next = dubaiDate(40);
    const { data: sub, error: sErr } = await db
      .from("subscriptions")
      .insert({
        name: subName,
        vendor_id: vendor!.id,
        kind: "subscription",
        billing_cycle: "monthly",
        billing_day: Number(next.slice(8, 10)),
        currency: "AED",
        next_charge_date: next,
        auto_renew: true,
        tiered_seats: true,
      })
      .select("id")
      .single();
    if (sErr) throw sErr;
    subId = sub!.id;
    const { data: person, error: pErr } = await db
      .from("people")
      .insert({ full_name: saraName, department: "IT" })
      .select("id")
      .single();
    if (pErr) throw pErr;
    personId = person!.id;

    const panel = page.getByRole("complementary", { name: `${subName} detail` });
    const seatsBlock = panel.getByRole("region", { name: "Seats" });
    const counts = seatsBlock.getByTestId("seat-counts");
    const table = seatsBlock.getByRole("table", { name: "Seat roster" });
    // Every subscription shows Invoices and Seats as tabs (the last one used is remembered).
    const showTab = (name: "Invoices" | "Seats") =>
      panel.getByRole("tab", { name: new RegExp(`^${name}`) }).click();

    // ------------------------------------------------------------------------- import
    await step("Seats: import Claude's admin export (preview, problems, commit)", async () => {
      await page.goto(`/subscriptions?sub=${subId}`);
      await ex(panel).toBeVisible();
      // Invoices opens first; the Seats tab is there even with no seats yet.
      await ex(panel.getByRole("tab", { name: /^Invoices/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await ex(panel.getByRole("button", { name: "Import seats" })).toHaveCount(0);
      await showTab("Seats");
      await ex(panel.getByRole("button", { name: "Add invoice" })).toHaveCount(0);
      await ex(counts).toHaveText("No seats yet");
      await seatsBlock.getByRole("button", { name: "Import seats" }).click();
      const dialog = page.getByRole("dialog", { name: /^Import seats for/ });

      // A bad seat type blocks the import and names the row.
      await dialog.getByLabel("Paste a list").fill(`${email("x")}, Gold\n${email("y")}, Standard`);
      await dialog.getByRole("button", { name: "Check pasted list" }).click();
      await ex(dialog.getByRole("list", { name: "Problems" })).toContainText("unknown seat type");
      await ex(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();

      // Claude's admin export, as a file: email is the person, unassigned/pending are skipped.
      const csv =
        '"Name","Email","Role","Status","Seat Tier"\r\n' +
        `"A","${email("a")}","Member","Active","Premium"\r\n` +
        `"B","${email("b")}","Member","Active","Standard"\r\n` +
        `"C","${email("c")}","Admin","Active","standard"\r\n` +
        `"D","${email("d")}","Member","Active","Unassigned"\r\n` +
        `"E","${email("e")}","Member","Pending","Standard"\r\n`;
      await dialog.getByLabel("Or a CSV file").setInputFiles({
        name: "claude-members.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      const summary = dialog.getByTestId("seat-import-summary");
      await ex(summary).toContainText("1 unassigned member skipped · 1 not active skipped");
      await ex(summary).toContainText("3 seats to add: 2 Standard · 1 Premium");
      await ex(dialog.getByRole("table", { name: "Import preview" })).toContainText(email("a"));
      await shot(dialog, "import-preview");
      await dialog.getByRole("button", { name: "Import 3 seats" }).click();
      await ex(dialog).toBeHidden();
      await ex(counts).toHaveText("Standard 2 · Premium 1");
      await ex(table).toContainText(email("a"));
      // The roster shows the email as the person.
      await ex(table.getByRole("row").filter({ hasText: email("a") })).toContainText("Premium");
    });

    // ------------------------------------------------------- add / edit / remove / past
    await step("Seats: add, edit, remove a seat, filter, past seats, CSV", async () => {
      await seatsBlock.getByRole("button", { name: "Add seat" }).click();
      const add = page.getByRole("dialog", { name: "Add seat" });
      await add.getByLabel("Person").fill(saraName);
      await add.getByLabel("Seat", { exact: true }).selectOption("premium");
      await add.getByLabel("Project").fill("E2E Bidding");
      await add.getByRole("button", { name: "Add seat" }).click();
      await ex(add).toBeHidden();
      await ex(counts).toHaveText("Standard 2 · Premium 2");
      // The same person can't hold a second active seat.
      await seatsBlock.getByRole("button", { name: "Add seat" }).click();
      const dup = page.getByRole("dialog", { name: "Add seat" });
      await dup.getByLabel("Person").fill(saraName.toLowerCase());
      await dup.getByRole("button", { name: "Add seat" }).click();
      await ex(dup.getByRole("alert")).toContainText("already holds an active seat");
      await dup.getByRole("button", { name: "Cancel" }).click();

      // Edit: the tier and the project change in place.
      await seatsBlock.getByRole("button", { name: `Edit seat: ${saraName}` }).click();
      const edit = page.getByRole("dialog", { name: `Edit ${saraName}’s seat` });
      await edit.getByLabel("Seat", { exact: true }).selectOption("standard");
      await edit.getByLabel("Project").fill("E2E Ops");
      await edit.getByRole("button", { name: "Save" }).click();
      await ex(edit).toBeHidden();
      await ex(counts).toHaveText("Standard 3 · Premium 1");
      await ex(table.getByRole("row").filter({ hasText: saraName })).toContainText("E2E Ops");

      // Filter by name or project.
      await seatsBlock.getByLabel("Filter seats by name or project").fill("e2e ops");
      await ex(table.getByRole("row").filter({ hasText: "@example.test" })).toHaveCount(0);
      await ex(table.getByRole("row").filter({ hasText: saraName })).toHaveCount(1);
      await seatsBlock.getByLabel("Filter seats by name or project").fill("");

      // Remove (confirm); the seat leaves the list (past seats aren't shown).
      await seatsBlock.getByRole("button", { name: `Remove seat: ${saraName}` }).click();
      const confirm = page.getByRole("dialog", { name: `Remove ${saraName}’s seat?` });
      await confirm.getByRole("button", { name: "Remove seat" }).click();
      await ex(confirm).toBeHidden();
      await ex(counts).toHaveText("Standard 2 · Premium 1");
      await ex(table.getByRole("row").filter({ hasText: saraName })).toHaveCount(0);
      await ex(seatsBlock.getByText(/past seats/i)).toHaveCount(0);
      await shot(seatsBlock, "seats-section");

      // CSV export: the seats held now.
      const res = await page.request.get(`/subscriptions/seats/export?sub=${subId}`);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body.split("\r\n")[0]).toBe("Person,Seat,Project,Source");
      expect(body).not.toContain(saraName);
      expect(body).toContain(`${email("a")},Premium,,Import`);

      // Give Sara her seat back for the offboarding step.
      await seatsBlock.getByRole("button", { name: "Add seat" }).click();
      const again = page.getByRole("dialog", { name: "Add seat" });
      await again.getByLabel("Person").fill(saraName);
      await again.getByLabel("Seat", { exact: true }).selectOption("premium");
      await again.getByLabel("Project").fill("E2E Bidding");
      await again.getByRole("button", { name: "Add seat" }).click();
      await ex(again).toBeHidden();
      await ex(counts).toHaveText("Standard 2 · Premium 2");
    });

    // ------------------------------------------------------------- pro-rated → roster
    await step("Seats: a pro-rated invoice adds its seat to the roster", async () => {
      await showTab("Invoices");
      await panel.getByRole("button", { name: "Add invoice" }).click();
      const pr = page.getByRole("dialog", { name: "Add invoice" });
      await pr.getByRole("button", { name: "Pro-rated" }).click();
      await pr.getByLabel("Seat 1 person").fill(`E2E Prorated ${stamp}`);
      await pr.getByLabel("Seat 1 tier").selectOption("standard");
      await pr.getByLabel(/^Amount/).fill("40");
      await pr.getByRole("button", { name: "Add invoice" }).click();
      await ex(pr).toBeHidden();
      await showTab("Seats");
      await ex(counts).toHaveText("Standard 3 · Premium 2");
      await ex(table).toContainText(`E2E Prorated ${stamp}`);
    });

    // ----------------------------------------------- renewal pre-fill and mismatch note
    await step("Seats: the renewal invoice follows the roster and flags a difference", async () => {
      await showTab("Invoices");
      await panel.getByRole("button", { name: "Add invoice" }).click();
      const add = page.getByRole("dialog", { name: "Add invoice" });
      await add.getByLabel("Charge date").fill(dubaiDate(2));
      await ex(add.getByLabel("Standard seats")).toHaveValue("3");
      await ex(add.getByLabel("Premium seats")).toHaveValue("2");
      await ex(add.getByTestId("roster-mismatch")).toHaveCount(0);
      await add.getByLabel("Standard seats").fill("2");
      await ex(add.getByTestId("roster-mismatch")).toHaveText(
        "Roster has 3 Standard; invoice says 2.",
      );
      await shot(add, "renewal-mismatch");
      await add.getByLabel("Standard seats").fill("3");
      await ex(add.getByTestId("roster-mismatch")).toHaveCount(0);
      await add.getByLabel(/^Amount/).fill("100");
      await add.getByRole("button", { name: "Add invoice" }).click();
      await ex(add).toBeHidden();
      const ledger = panel.getByRole("table", { name: "Invoice ledger" });
      await ex(ledger).toContainText("Standard 3 · Premium 2");
      // The detail panel's own count line agrees with the roster.
      await ex(panel.locator("dl.kv")).toContainText("Standard 3 · Premium 2 (5 seats)");
    });

    // ---------------------------------------------------------------------- search
    await step("Seats: search finds a seat and links to the subscription", async () => {
      await page.goto("/");
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox").fill(saraName);
      const hit = page.getByRole("option").filter({ hasText: subName });
      await ex(hit.first()).toBeVisible();
      await hit.first().click();
      await ex(page).toHaveURL(new RegExp(`sub=${subId}`));
    });

    // -------------------------------------------------------------------- offboarding
    await step("Seats: offboarding adds an item per seat; ticking ends the seat", async () => {
      await page.goto("/onboarding?new=1");
      const dialog = page.getByRole("dialog", { name: "New checklist" });
      await dialog.getByLabel("Type").selectOption("offboarding");
      await dialog.getByLabel("Person").selectOption(personId);
      await dialog.getByLabel("Last day").fill(dubaiDate(10));
      await dialog.getByRole("button", { name: "Create checklist" }).click();
      await ex(page).toHaveURL(/[?&]checklist=[0-9a-f-]{36}/);
      const label = `Remove ${subName} seat (Premium)`;
      await ex(page.getByText(label, { exact: true })).toBeVisible();
      // The person panel lists the seat they hold.
      await ex(page.getByTestId("person-seats")).toContainText(
        `${subName} · Premium · E2E Bidding`,
      );
      await shot(page.locator("main"), "offboarding-item");
      // It is a task like the others.
      await page.goto(`/tasks?q=${encodeURIComponent(label)}`);
      await ex(page.getByRole("row").filter({ hasText: `${label} — ${saraName}` })).toBeVisible();
      await page.goBack();

      // Wait for the save itself: the tick shows at once, before the server has it.
      const ticked = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("checkbox", { name: `Done: ${label}` }).check();
      await ex(page.getByRole("checkbox", { name: `Done: ${label}` })).toBeChecked();
      await ticked;
      await page.goto(`/subscriptions?sub=${subId}`);
      await showTab("Seats");
      await ex(counts).toHaveText("Standard 3 · Premium 1");
      await ex(table.getByRole("row").filter({ hasText: saraName })).toHaveCount(0);

      // Unticking brings the seat back.
      await page.goBack();
      await page.reload();
      const unticked = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("checkbox", { name: `Done: ${label}` }).uncheck();
      await ex(page.getByRole("checkbox", { name: `Done: ${label}` })).not.toBeChecked();
      await unticked;
      await page.goto(`/subscriptions?sub=${subId}`);
      await ex(counts).toHaveText("Standard 3 · Premium 2");
    });

    // ---------------------------------------------------------------------- activity
    await step("Seats: the activity log has readable sentences", async () => {
      await page.goto(`/activity?range=today&q=${encodeURIComponent(subName)}`);
      const log = page.getByRole("table", { name: "Activity" });
      await ex(log).toContainText(`Imported a premium seat for ${email("a")} to`);
      await ex(log).toContainText(`Added a premium seat for ${saraName} to`);
      await ex(log).toContainText(`Ended ${saraName}’s seat on`);
    });

    // ------------------------------------------------------------- a longer list stays usable
    await step("Seats: a long list scrolls inside the section", async () => {
      await page.goto(`/subscriptions?sub=${subId}`);
      await showTab("Seats");
      await seatsBlock.getByRole("button", { name: "Import seats" }).click();
      const dialog = page.getByRole("dialog", { name: /^Import seats for/ });
      const more = "fghijklmnopqrstu".split("");
      await dialog
        .getByLabel("Paste a list")
        .fill(
          more
            .map(
              (l, i) => `${email(l)}\t${i % 5 === 0 ? "Premium" : "Standard"}\tE2E Team ${i % 3}`,
            )
            .join("\n"),
        );
      await dialog.getByRole("button", { name: "Check pasted list" }).click();
      await ex(dialog.getByTestId("seat-import-summary")).toContainText("16 seats to add");
      await dialog.getByRole("button", { name: "Import 16 seats" }).click();
      await ex(dialog).toBeHidden();
      await ex(counts).toHaveText("Standard 15 · Premium 6");
      const list = seatsBlock.getByLabel("Seat list");
      // The list scrolls inside the section; the panel is not stretched by it.
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await shot(seatsBlock, "seats-section-long");
      await showTab("Invoices"); // leave the remembered tab as it starts
    });
  } finally {
    // Only this run's E2E rows (the roster, invoices and checklist go with their parents).
    if (subId) {
      const { data: invs } = await db
        .from("subscription_invoices")
        .select("id")
        .eq("subscription_id", subId);
      const ids = (invs ?? []).map((i) => i.id);
      if (ids.length) {
        const { data: docs } = await db
          .from("documents")
          .select("id, storage_path")
          .eq("owner_type", "subscription_invoice")
          .in("owner_id", ids);
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
      }
      await db.from("subscriptions").delete().eq("id", subId).eq("name", subName);
    }
    if (personId) await db.from("people").delete().eq("id", personId).eq("full_name", saraName);
    await db.from("vendors").delete().eq("name", vendorName);
  }
}
