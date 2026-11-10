import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * The Delete workflow, shared by the focused spec (e2e/focus/delete.spec.ts) and the full
 * suite (e2e/workflows.spec.ts). It creates its own E2E records straight in the database
 * (a subscription with invoices, a purchase with documents, a stock item and an
 * onboarding checklist), then deletes them through the UI and checks what went and what
 * stayed. Nothing else is touched; whatever is left after a failure is removed at the end.
 */
const ex = expect.configure({ timeout: 15_000 });

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const label = (iso: string) => `${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ’${iso.slice(2, 4)}`;
const plusDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type Step = (title: string, body: () => Promise<void>) => Promise<void>;

export async function deleteSteps(page: Page, step: Step, stamp: string) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const must = async <T>(q: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as NonNullable<T>;
  };
  const created = {
    vendors: [] as string[],
    subs: [] as string[],
    pos: [] as string[],
    stock: [] as string[],
    people: [] as string[],
  };
  const short = stamp.slice(-8);
  const next = plusDays(40);
  const aId = "2025-01-05";
  const bId = "2025-02-05";

  const vendor = await must(
    db
      .from("vendors")
      .insert({ name: `E2E Vendor Del ${stamp}` })
      .select("id")
      .single(),
  );
  created.vendors.push(vendor.id);

  try {
    // ------------------------------------------------------------ subscription
    const subName = `E2E Delete Sub ${stamp}`;
    const sub = await must(
      db
        .from("subscriptions")
        .insert({
          name: subName,
          vendor_id: vendor.id,
          billing_cycle: "monthly",
          cost_original: 50,
          currency: "AED",
          cost_aed: 50,
          next_charge_date: next,
          auto_renew: true,
        })
        .select("id")
        .single(),
    );
    created.subs.push(sub.id);
    const invoice = async (periodStart: string, status: string) =>
      (
        await must(
          db
            .from("subscription_invoices")
            .upsert(
              {
                subscription_id: sub.id,
                period_start: periodStart,
                period_label: label(periodStart),
                amount_original: 50,
                amount_aed: 50,
                status,
              },
              { onConflict: "subscription_id,period_start" },
            )
            .select("id")
            .single(),
        )
      ).id as string;
    const invA = await invoice(aId, "on_file");
    const invB = await invoice(bId, "on_file");
    await invoice(next, "upcoming");
    for (const [owner, name] of [
      [invA, "a"],
      [invB, "b"],
    ] as const) {
      const doc = await must(
        db
          .from("documents")
          .insert({
            owner_type: "subscription_invoice",
            owner_id: owner,
            kind: "invoice",
            storage_path: `e2e-delete/${stamp}/${name}.pdf`,
            file_name: `E2E_${stamp}_${name}.pdf`,
            size_bytes: 10,
          })
          .select("id")
          .single(),
      );
      await must(db.from("subscription_invoices").update({ document_id: doc.id }).eq("id", owner));
    }
    const subTask = await must(
      db
        .from("tasks")
        .insert({ title: `E2E sub task ${stamp}`, subscription_id: sub.id })
        .select("id")
        .single(),
    );

    await step(
      "Delete: remove a ledger period, it stays removed after a reload, no restore option",
      async () => {
        await page.goto(`/subscriptions?sub=${sub.id}`);
        const ledger = page.getByRole("table", { name: "Invoice ledger" });
        await ex(ledger.getByRole("row")).toHaveCount(3);
        const upcomingRow = ledger.getByRole("row").filter({ hasText: label(next) });
        await upcomingRow.getByRole("button", { name: /^Remove period/ }).click();
        const confirm = page.getByRole("dialog", {
          name: `Remove ${label(next)} from the ledger?`,
        });
        await ex(confirm).toContainText("It won’t come back.");
        await ex(confirm).toContainText("fix the subscription’s Next charge date");
        await confirm.getByRole("button", { name: "Remove period" }).click();
        await ex(confirm).toBeHidden();
        await ex(page.locator(".toasts")).toContainText(`Removed ${label(next)} from the ledger`);
        await ex(ledger.getByRole("row")).toHaveCount(2);
        // The roll-over runs on every load; the removed period must not come back.
        await page.reload();
        await ex(ledger.getByRole("row")).toHaveCount(2);
        await ex(page.getByText(/Show removed/)).toHaveCount(0);
        await ex(page.getByRole("button", { name: /^Restore/ })).toHaveCount(0);
      },
    );

    await step("Delete: remove one invoice file, the period goes back to Missing", async () => {
      const ledger = page.getByRole("table", { name: "Invoice ledger" });
      const rowA = ledger.getByRole("row").filter({ hasText: label(aId) });
      await ex(rowA).toContainText("On file");
      await rowA.getByRole("button", { name: /^Remove file/ }).click();
      const confirm = page.getByRole("dialog", {
        name: `Remove the invoice file for ${label(aId)}?`,
      });
      await confirm.getByRole("button", { name: "Remove file" }).click();
      await ex(confirm).toBeHidden();
      await ex(rowA).toContainText("Missing");
    });

    await step(
      "Delete: subscription, with its invoices and file; the task is kept, unlinked",
      async () => {
        await page.getByRole("button", { name: /^Edit/ }).first().click();
        const dialog = page.getByRole("dialog", { name: "Edit subscription" });
        await dialog.getByRole("button", { name: "Delete subscription" }).click();
        const confirm = page.getByRole("dialog", { name: `Delete ${subName}?` });
        await ex(confirm).toContainText("This also deletes 2 invoices and 1 attached file.");
        await ex(confirm).toContainText("1 linked task stays, unlinked.");
        await ex(confirm).toContainText("This can’t be undone.");
        if (process.env.DELETE_SHOTS)
          await page.screenshot({ path: `${process.env.DELETE_SHOTS}/delete-confirm.png` });
        await confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await ex(page.locator(".toasts")).toContainText(`Deleted ${subName}`);
        await ex(confirm).toBeHidden();
        await ex(dialog).toBeHidden();
        await ex(page).not.toHaveURL(/sub=/);
        expect(await must(db.from("subscriptions").select("id").eq("id", sub.id))).toHaveLength(0);
        expect(
          await must(db.from("subscription_invoices").select("id").eq("subscription_id", sub.id)),
        ).toHaveLength(0);
        expect(
          await must(db.from("documents").select("id").in("owner_id", [invA, invB])),
        ).toHaveLength(0);
        const [task] = await must(db.from("tasks").select("subscription_id").eq("id", subTask.id));
        expect(task!.subscription_id).toBeNull();
      },
    );

    // ---------------------------------------------------------------- purchase
    const poNumber = `PO-9${Math.floor(100 + Math.random() * 900)}-${short.slice(-4)}`;
    const po = await must(
      db
        .from("purchase_orders")
        .insert({
          po_number: poNumber,
          vendor_id: vendor.id,
          requested_on: plusDays(0),
          status: "ordered",
          notes: `E2E ${stamp}`,
        })
        .select("id")
        .single(),
    );
    created.pos.push(po.id);
    await must(
      db.from("po_lines").insert([
        { po_id: po.id, description: `E2E ${stamp} line 1`, qty: 1, unit_price_aed: 10 },
        { po_id: po.id, description: `E2E ${stamp} line 2`, qty: 2, unit_price_aed: 10 },
      ]),
    );
    for (const kind of ["approval", "invoice"] as const)
      await must(
        db.from("documents").insert({
          owner_type: "purchase_order",
          owner_id: po.id,
          kind,
          storage_path: `e2e-delete/${stamp}/po-${kind}.pdf`,
          file_name: `E2E_${stamp}_${kind}.pdf`,
          size_bytes: 10,
        }),
      );
    const poTask = await must(
      db
        .from("tasks")
        .insert({ title: `E2E po task ${stamp}`, po_id: po.id })
        .select("id")
        .single(),
    );

    await step("Delete: remove one PO document, the slot shows Missing again", async () => {
      await page.goto(`/procurement?po=${poNumber}`);
      const slot = page.locator(".slot", { hasText: "Invoice" });
      await slot.getByRole("button", { name: /^Remove file/ }).click();
      const confirm = page.getByRole("dialog", { name: "Remove the invoice?" });
      await confirm.getByRole("button", { name: "Remove file" }).click();
      await ex(confirm).toBeHidden();
      await ex(slot).toContainText("Missing");
      expect(await must(db.from("documents").select("id").eq("owner_id", po.id))).toHaveLength(1);
    });

    await step(
      "Delete: purchase, with its lines and documents; the task is kept, unlinked",
      async () => {
        await page.getByRole("button", { name: /^Edit/ }).first().click();
        const dialog = page.getByRole("dialog", { name: "Edit purchase" });
        await dialog.getByRole("button", { name: "Delete purchase" }).click();
        const confirm = page.getByRole("dialog", { name: `Delete ${poNumber}?` });
        await ex(confirm).toContainText("This also deletes 2 line items and 1 attached file.");
        await ex(confirm).toContainText("1 linked task stays, unlinked.");
        await confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await ex(page.locator(".toasts")).toContainText(`Deleted ${poNumber}`);
        await ex(dialog).toBeHidden();
        await ex(page).not.toHaveURL(/po=/);
        expect(await must(db.from("purchase_orders").select("id").eq("id", po.id))).toHaveLength(0);
        expect(await must(db.from("po_lines").select("id").eq("po_id", po.id))).toHaveLength(0);
        expect(await must(db.from("documents").select("id").eq("owner_id", po.id))).toHaveLength(0);
        const [task] = await must(db.from("tasks").select("po_id").eq("id", poTask.id));
        expect(task!.po_id).toBeNull();
      },
    );

    // ------------------------------------------------------------------- stock
    const tag = `E2E-DEL-${short}`;
    const item = await must(
      db
        .from("stock_items")
        .insert({ tag, model: `E2E Dock ${stamp}` })
        .select("id")
        .single(),
    );
    created.stock.push(item.id);
    await step("Delete: stock item", async () => {
      await page.goto(`/stock?q=${tag}`);
      await page.getByRole("button", { name: `Edit ${tag}` }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${tag}` });
      await dialog.getByRole("button", { name: "Delete item" }).click();
      const confirm = page.getByRole("dialog", { name: `Delete ${tag}?` });
      await ex(confirm).toContainText("use Retire instead");
      await confirm.getByRole("button", { name: "Delete", exact: true }).click();
      await ex(page.locator(".toasts")).toContainText(`Deleted ${tag}`);
      await ex(dialog).toBeHidden();
      expect(await must(db.from("stock_items").select("id").eq("id", item.id))).toHaveLength(0);
    });

    // --------------------------------------------------------------- checklist
    const personName = `E2E Leaver ${stamp}`;
    const person = await must(
      db.from("people").insert({ full_name: personName }).select("id").single(),
    );
    created.people.push(person.id);
    const checklist = await must(
      db
        .from("checklists")
        .insert({ person_id: person.id, kind: "offboarding", target_date: next })
        .select("id")
        .single(),
    );
    for (const [sort, text] of ["E2E revoke access", "E2E collect laptop"].entries()) {
      const row = await must(
        db
          .from("checklist_items")
          .insert({
            checklist_id: checklist.id,
            section: "accounts",
            sort,
            label: `${text} ${stamp}`,
          })
          .select("id")
          .single(),
      );
      await must(
        db.from("tasks").insert({
          title: `${text} ${stamp}`,
          source: "checklist",
          checklist_item_id: row.id,
          person_id: person.id,
        }),
      );
    }
    await step(
      "Delete: checklist, with its items and tasks, and the person nothing else refers to",
      async () => {
        await page.goto(`/onboarding?checklist=${checklist.id}`);
        await page.getByRole("button", { name: "Delete checklist" }).click();
        const confirm = page.getByRole("dialog", {
          name: `Delete the offboarding checklist for ${personName}?`,
        });
        await ex(confirm).toContainText("2 checklist items");
        await ex(confirm).toContainText("2 generated tasks");
        await ex(confirm).toContainText(`${personName}’s person record`);
        await confirm.getByRole("button", { name: "Delete", exact: true }).click();
        await ex(page.locator(".toasts")).toContainText("Deleted the offboarding checklist");
        await ex(confirm).toBeHidden();
        await ex(page).not.toHaveURL(/checklist=/);
        expect(await must(db.from("checklists").select("id").eq("id", checklist.id))).toHaveLength(
          0,
        );
        expect(
          await must(db.from("checklist_items").select("id").eq("checklist_id", checklist.id)),
        ).toHaveLength(0);
        expect(await must(db.from("tasks").select("id").eq("person_id", person.id))).toHaveLength(
          0,
        );
        expect(await must(db.from("people").select("id").eq("id", person.id))).toHaveLength(0);
      },
    );
  } finally {
    // Whatever a failed run left behind (only E2E records made above).
    await db.from("tasks").delete().like("title", `E2E %${stamp}`);
    if (created.subs.length) await db.from("subscriptions").delete().in("id", created.subs);
    if (created.pos.length) {
      await db.from("documents").delete().in("owner_id", created.pos);
      await db.from("purchase_orders").delete().in("id", created.pos);
    }
    if (created.stock.length) await db.from("stock_items").delete().in("id", created.stock);
    if (created.people.length) await db.from("people").delete().in("id", created.people);
    await db.from("documents").delete().like("storage_path", `e2e-delete/${stamp}/%`);
    await db.from("vendors").delete().in("id", created.vendors);
  }
}
