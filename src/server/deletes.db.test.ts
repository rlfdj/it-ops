import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  alertStates,
  checklistItems,
  checklists,
  documents,
  notes,
  people,
  poLines,
  purchaseOrders,
  stockItems,
  subscriptionInvoices,
  subscriptions,
  tasks,
} from "@/db/schema";
import { client, inRollback } from "@/test/db";
import type { Tx } from "@/db/actor";
import { createSubscription, ensureInvoicePeriods, addInvoicePeriod } from "./subscriptions";
import { createPo } from "./procurement";
import { addStock } from "./stock";
import { createChecklist } from "./checklists";
import { createTask } from "./tasks";
import {
  checklistDeleteImpact,
  deleteChecklist,
  deletePurchase,
  deleteStockItem,
  deleteSubscription,
  purchaseDeleteImpact,
  removeInvoiceDocument,
  removeInvoicePeriod,
  removePoDocument,
  subscriptionDeleteImpact,
} from "./deletes";
import { deleteDescription } from "@/lib/delete-text";

afterAll(() => client.end());

const TODAY = "2026-10-14";

async function newSub(tx: Tx, name: string) {
  const { id } = await createSubscription(tx, {
    name,
    vendorName: "E2E Vendor",
    kind: "subscription",
    billingCycle: "monthly",
    costOriginal: 100,
    currency: "AED",
    nextChargeDate: "2026-11-05",
    autoRenew: true,
  } as never);
  return id;
}

async function addDoc(
  tx: Tx,
  ownerType: "subscription_invoice" | "purchase_order" | "note",
  ownerId: string,
  path: string,
  kind: "invoice" | "approval" | "other" = "invoice",
) {
  const [doc] = await tx
    .insert(documents)
    .values({ ownerType, ownerId, kind, storagePath: path, fileName: path, sizeBytes: 10 })
    .returning({ id: documents.id });
  return doc!.id;
}

describe("delete subscription", () => {
  it("removes invoices and their files, unlinks tasks and notes, keeps everything else", async () => {
    await inRollback(async (tx) => {
      const id = await newSub(tx, "E2E Delete Sub");
      const other = await newSub(tx, "E2E Other Sub");
      const a = await addInvoicePeriod(
        tx,
        { subscriptionId: id, periodStart: "2026-01-05", amountOriginal: 10 },
        TODAY,
      );
      const b = await addInvoicePeriod(
        tx,
        { subscriptionId: id, periodStart: "2026-02-05", amountOriginal: 10 },
        TODAY,
      );
      const o = await addInvoicePeriod(
        tx,
        { subscriptionId: other, periodStart: "2026-01-05", amountOriginal: 10 },
        TODAY,
      );
      const da = await addDoc(tx, "subscription_invoice", a.id, "e2e/a.pdf");
      await addDoc(tx, "subscription_invoice", b.id, "e2e/b.pdf");
      await addDoc(tx, "subscription_invoice", o.id, "e2e/o.pdf");
      await tx
        .update(subscriptionInvoices)
        .set({ documentId: da })
        .where(eq(subscriptionInvoices.id, a.id));
      const taskId = await createTask(tx, { title: "E2E linked", subscriptionId: id });
      const [note] = await tx
        .insert(notes)
        .values({ text: "E2E note", subscriptionId: id })
        .returning({ id: notes.id });
      await tx
        .insert(alertStates)
        .values({ alertKey: `renewal:${id}:2026-11-05:30`, state: "read" });

      const impact = await subscriptionDeleteImpact(tx, { id });
      expect(deleteDescription(impact)).toBe(
        "This also deletes 2 invoices and 2 attached files. 1 linked task stays, unlinked. 1 linked note stays, unlinked. This can’t be undone.",
      );

      const { paths } = await deleteSubscription(tx, { id });
      expect(paths.sort()).toEqual(["e2e/a.pdf", "e2e/b.pdf"]);
      expect(await tx.select().from(subscriptions).where(eq(subscriptions.id, id))).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(subscriptionInvoices)
          .where(eq(subscriptionInvoices.subscriptionId, id)),
      ).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(documents)
          .where(inArray(documents.ownerId, [a.id, b.id])),
      ).toHaveLength(0);
      expect(
        await tx
          .select()
          .from(alertStates)
          .where(eq(alertStates.alertKey, `renewal:${id}:2026-11-05:30`)),
      ).toHaveLength(0);
      // Kept: the task and note (unlinked), the other subscription, its invoice and file.
      const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      expect(t?.subscriptionId).toBeNull();
      const [n] = await tx.select().from(notes).where(eq(notes.id, note!.id));
      expect(n?.subscriptionId).toBeNull();
      expect(await tx.select().from(subscriptions).where(eq(subscriptions.id, other))).toHaveLength(
        1,
      );
      expect(await tx.select().from(documents).where(eq(documents.ownerId, o.id))).toHaveLength(1);
    });
  });

  it("refuses a subscription that is already gone", async () => {
    await inRollback(async (tx) => {
      await expect(deleteSubscription(tx, { id: crypto.randomUUID() })).rejects.toThrow(
        /already gone/,
      );
    });
  });
});

describe("delete purchase", () => {
  it("removes lines and documents, unlinks tasks and notes", async () => {
    await inRollback(async (tx) => {
      const { id, poNumber } = await createPo(tx, {
        vendorName: "E2E Vendor",
        requestedOn: TODAY,
        lines: [
          { description: "E2E a", qty: 1, unitPriceAed: 5 },
          { description: "E2E b", qty: 2, unitPriceAed: 5 },
        ],
      });
      const keep = await createPo(tx, {
        vendorName: "E2E Vendor",
        requestedOn: TODAY,
        lines: [{ description: "E2E keep", qty: 1, unitPriceAed: 5 }],
      });
      await addDoc(tx, "purchase_order", id, "e2e/po-approval.pdf", "approval");
      await addDoc(tx, "purchase_order", keep.id, "e2e/keep.pdf", "approval");
      const taskId = await createTask(tx, { title: "E2E po task", poId: id });
      const [note] = await tx
        .insert(notes)
        .values({ text: "E2E", poId: id })
        .returning({ id: notes.id });

      const impact = await purchaseDeleteImpact(tx, { id });
      expect(impact.name).toBe(poNumber);
      expect(impact.deletes).toEqual(["2 line items", "1 attached file"]);

      const { paths } = await deletePurchase(tx, { id });
      expect(paths).toEqual(["e2e/po-approval.pdf"]);
      expect(await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id))).toHaveLength(
        0,
      );
      expect(await tx.select().from(poLines).where(eq(poLines.poId, id))).toHaveLength(0);
      expect((await tx.select().from(tasks).where(eq(tasks.id, taskId)))[0]?.poId).toBeNull();
      expect((await tx.select().from(notes).where(eq(notes.id, note!.id)))[0]?.poId).toBeNull();
      expect(await tx.select().from(poLines).where(eq(poLines.poId, keep.id))).toHaveLength(1);
      expect(await tx.select().from(documents).where(eq(documents.ownerId, keep.id))).toHaveLength(
        1,
      );
    });
  });

  it("removes one document and leaves the others", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPo(tx, {
        vendorName: "E2E Vendor",
        requestedOn: TODAY,
        lines: [{ description: "E2E x", qty: 1, unitPriceAed: 5 }],
      });
      await addDoc(tx, "purchase_order", id, "e2e/inv.pdf", "invoice");
      await addDoc(tx, "purchase_order", id, "e2e/appr.pdf", "approval");
      expect(await removePoDocument(tx, { poId: id, kind: "invoice" })).toEqual(["e2e/inv.pdf"]);
      const left = await tx.select().from(documents).where(eq(documents.ownerId, id));
      expect(left.map((d) => d.kind)).toEqual(["approval"]);
      await expect(removePoDocument(tx, { poId: id, kind: "invoice" })).rejects.toThrow(
        /already gone/,
      );
    });
  });
});

describe("delete stock item", () => {
  it("deletes the item and nothing else", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, {
        items: [
          { tag: "E2E-DEL-1", model: "E2E" },
          { tag: "E2E-DEL-2", model: "E2E" },
        ],
      });
      const [row] = await tx.select().from(stockItems).where(eq(stockItems.tag, "E2E-DEL-1"));
      expect(await deleteStockItem(tx, { id: row!.id })).toEqual({ name: "E2E-DEL-1" });
      expect(
        await tx.select().from(stockItems).where(eq(stockItems.tag, "E2E-DEL-1")),
      ).toHaveLength(0);
      expect(
        await tx.select().from(stockItems).where(eq(stockItems.tag, "E2E-DEL-2")),
      ).toHaveLength(1);
      await expect(deleteStockItem(tx, { id: row!.id })).rejects.toThrow(/already gone/);
    });
  });
});

const items = [
  { section: "accounts" as const, label: "E2E item a", children: [] },
  { section: "assets" as const, label: "E2E equipment", children: ["E2E laptop", "E2E phone"] },
];

describe("delete checklist", () => {
  it("removes items and generated tasks, and the person when nothing else refers to them", async () => {
    await inRollback(async (tx) => {
      const { checklistId, personId } = await createChecklist(tx, {
        kind: "onboarding",
        targetDate: "2026-11-01",
        person: { fullName: "E2E Newbie" },
        items,
      });
      const other = await createChecklist(tx, {
        kind: "onboarding",
        targetDate: "2026-11-01",
        person: { fullName: "E2E Other" },
        items,
      });
      const impact = await checklistDeleteImpact(tx, { id: checklistId });
      expect(impact.deletesPerson).toBe(true);
      expect(impact.deletes).toEqual([
        "4 checklist items",
        "2 generated tasks",
        "E2E Newbie’s person record",
      ]);

      const result = await deleteChecklist(tx, { id: checklistId });
      expect(result.personDeleted).toBe(true);
      expect(await tx.select().from(checklists).where(eq(checklists.id, checklistId))).toHaveLength(
        0,
      );
      expect(
        await tx.select().from(checklistItems).where(eq(checklistItems.checklistId, checklistId)),
      ).toHaveLength(0);
      expect(await tx.select().from(tasks).where(eq(tasks.personId, personId))).toHaveLength(0);
      expect(await tx.select().from(people).where(eq(people.id, personId))).toHaveLength(0);
      // The other checklist, its items, tasks and person are untouched.
      expect(
        await tx
          .select()
          .from(checklistItems)
          .where(eq(checklistItems.checklistId, other.checklistId)),
      ).toHaveLength(4);
      expect(await tx.select().from(tasks).where(eq(tasks.personId, other.personId))).toHaveLength(
        2,
      );
      expect(await tx.select().from(people).where(eq(people.id, other.personId))).toHaveLength(1);
    });
  });

  it("keeps the person when another checklist, a manual task or a note refers to them", async () => {
    for (const reason of ["checklist", "task", "note"] as const) {
      await inRollback(async (tx) => {
        const first = await createChecklist(tx, {
          kind: "onboarding",
          targetDate: "2026-11-01",
          person: { fullName: `E2E Keep ${reason}` },
          items,
        });
        if (reason === "checklist")
          await createChecklist(tx, {
            kind: "offboarding",
            targetDate: "2027-01-01",
            person: { id: first.personId },
            items,
          });
        if (reason === "task")
          await createTask(tx, { title: "E2E manual", personId: first.personId });
        if (reason === "note")
          await tx.insert(notes).values({ text: "E2E", personId: first.personId });

        const impact = await checklistDeleteImpact(tx, { id: first.checklistId });
        expect(impact.deletesPerson).toBe(false);
        expect(deleteDescription(impact)).toContain("person record stays");
        const result = await deleteChecklist(tx, { id: first.checklistId });
        expect(result.personDeleted).toBe(false);
        expect(await tx.select().from(people).where(eq(people.id, first.personId))).toHaveLength(1);
        expect(
          await tx.select().from(checklists).where(eq(checklists.id, first.checklistId)),
        ).toHaveLength(0);
      });
    }
  });
});

describe("invoice files and periods", () => {
  it("removing a file sends the period back to missing, or upcoming for a future one", async () => {
    await inRollback(async (tx) => {
      const id = await newSub(tx, "E2E File Sub");
      const past = await addInvoicePeriod(
        tx,
        { subscriptionId: id, periodStart: "2026-01-05", amountOriginal: 10 },
        TODAY,
      );
      const future = await addInvoicePeriod(
        tx,
        { subscriptionId: id, periodStart: "2026-12-05", amountOriginal: 10 },
        TODAY,
      );
      for (const [row, path] of [
        [past, "e2e/p.pdf"],
        [future, "e2e/f.pdf"],
      ] as const) {
        const docId = await addDoc(tx, "subscription_invoice", row.id, path);
        await tx
          .update(subscriptionInvoices)
          .set({ documentId: docId, status: "on_file" })
          .where(eq(subscriptionInvoices.id, row.id));
      }
      expect(await removeInvoiceDocument(tx, { invoiceId: past.id }, TODAY)).toEqual(["e2e/p.pdf"]);
      expect(await removeInvoiceDocument(tx, { invoiceId: future.id }, TODAY)).toEqual([
        "e2e/f.pdf",
      ]);
      const rows = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.subscriptionId, id));
      expect(rows.find((r) => r.id === past.id)).toMatchObject({
        status: "missing",
        documentId: null,
      });
      expect(rows.find((r) => r.id === future.id)).toMatchObject({
        status: "upcoming",
        documentId: null,
      });
    });
  });

  it("a removed renewal period keeps a hidden marker, isn't recreated, and Add invoice reuses it", async () => {
    await inRollback(async (tx) => {
      const id = await newSub(tx, "E2E Period Sub");
      await ensureInvoicePeriods(tx, "2026-10-14");
      const at = (start: string) =>
        tx
          .select()
          .from(subscriptionInvoices)
          .where(
            and(
              eq(subscriptionInvoices.subscriptionId, id),
              eq(subscriptionInvoices.periodStart, start),
            ),
          );
      const [upcoming] = await at("2026-11-05");
      expect(upcoming?.status).toBe("upcoming");
      const docId = await addDoc(tx, "subscription_invoice", upcoming!.id, "e2e/gone.pdf");
      await tx
        .update(subscriptionInvoices)
        .set({ documentId: docId, status: "on_file" })
        .where(eq(subscriptionInvoices.id, upcoming!.id));

      const removed = await removeInvoicePeriod(tx, { invoiceId: upcoming!.id });
      expect(removed.paths).toEqual(["e2e/gone.pdf"]);
      await expect(removeInvoicePeriod(tx, { invoiceId: upcoming!.id })).rejects.toThrow(
        /already gone/,
      );

      // Time passes: the period would be missing and the roll-over runs again.
      await ensureInvoicePeriods(tx, "2026-12-01");
      const rows = await at("2026-11-05");
      expect(rows).toHaveLength(1); // not recreated
      expect(rows[0]!.removedAt).not.toBeNull();
      expect(rows[0]!.status).not.toBe("missing");

      // Add invoice for that month reuses the marker row.
      const added = await addInvoicePeriod(
        tx,
        { subscriptionId: id, periodStart: "2026-11-05", amountOriginal: 42 },
        "2026-12-01",
      );
      expect(added.id).toBe(upcoming!.id);
      const back = await at("2026-11-05");
      expect(back).toHaveLength(1);
      expect(back[0]).toMatchObject({ removedAt: null, status: "missing", documentId: null });
      expect(Number(back[0]!.amountOriginal)).toBe(42);
    });
  });

  it("a removed pro-rated or hand-added non-renewal row is deleted with its file", async () => {
    await inRollback(async (tx) => {
      const id = await newSub(tx, "E2E Prorated Sub");
      const pr = await addInvoicePeriod(
        tx,
        {
          subscriptionId: id,
          kind: "prorated",
          periodStart: "2026-10-20",
          amountOriginal: 5,
          seats: [{ personName: "E2E Person", tier: "standard" }],
        },
        TODAY,
      );
      const docId = await addDoc(tx, "subscription_invoice", pr.id, "e2e/pr.pdf");
      await tx
        .update(subscriptionInvoices)
        .set({ documentId: docId, status: "on_file" })
        .where(eq(subscriptionInvoices.id, pr.id));
      const removed = await removeInvoicePeriod(tx, { invoiceId: pr.id });
      expect(removed.paths).toEqual(["e2e/pr.pdf"]);
      expect(
        await tx.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.id, pr.id)),
      ).toHaveLength(0);
      expect(await tx.select().from(documents).where(eq(documents.id, docId))).toHaveLength(0);
    });
  });
});
