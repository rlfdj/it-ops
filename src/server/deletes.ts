// Hard deletes of records, with what goes with them. Each delete runs inside a caller-provided
// transaction (from withActor), so the activity log records it; stored files are returned as
// `paths` for the caller to remove from the bucket AFTER the transaction commits. The
// `*DeleteImpact` functions are read-only: the live counts for the confirmation text.
//
// What references what (see schema.ts), and what each delete does about it:
//   subscription  -> subscription_invoices (cascade), documents (owner_type "subscription_invoice",
//                    no FK, deleted here), tasks / notes / checklist items (set null: kept, unlinked)
//   purchase      -> po_lines (cascade), documents (owner_type "purchase_order", deleted here),
//                    tasks / notes (set null: kept, unlinked)
//   stock item    -> nothing refers to it
//   checklist     -> checklist_items (cascade, incl. sub-items), tasks of those items (cascade);
//                    the person is deleted too only when nothing else refers to them

import { and, eq, inArray, isNull, like, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { AppDb, Tx } from "../db/actor.ts";
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
} from "../db/schema.ts";
import { countOf, type DeleteImpact } from "../lib/delete-text.ts";
import { DomainError } from "../lib/domain-error.ts";
import { invoiceStatusFor } from "../lib/subscriptions.ts";

type Db = AppDb | Tx;

const idInput = z.object({ id: z.uuid() });

const gone = (what: string) => new DomainError(`That ${what} is already gone. Refresh the page.`);

async function count(db: Db, table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row?.n ?? 0;
}

/** Drops alert read/dismissed rows for deleted records (their keys embed the record id). */
async function dropAlertStates(tx: Tx, patterns: string[]) {
  if (!patterns.length) return;
  await tx.delete(alertStates).where(or(...patterns.map((p) => like(alertStates.alertKey, p))));
}

const linkedKeeps = (taskCount: number, noteCount: number): string[] => [
  ...(taskCount
    ? [`${countOf(taskCount, "linked task")} ${taskCount === 1 ? "stays" : "stay"}, unlinked.`]
    : []),
  ...(noteCount
    ? [`${countOf(noteCount, "linked note")} ${noteCount === 1 ? "stays" : "stay"}, unlinked.`]
    : []),
];

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type RecordImpact = DeleteImpact & { name: string };

export async function subscriptionDeleteImpact(
  db: Db,
  input: { id: string },
): Promise<RecordImpact> {
  const { id } = idInput.parse(input);
  const [sub] = await db
    .select({ name: subscriptions.name })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  if (!sub) throw gone("subscription");
  const invoices = await db
    .select({ id: subscriptionInvoices.id })
    .from(subscriptionInvoices)
    .where(
      and(eq(subscriptionInvoices.subscriptionId, id), isNull(subscriptionInvoices.removedAt)),
    );
  const files = invoices.length
    ? await count(
        db,
        documents,
        and(
          eq(documents.ownerType, "subscription_invoice"),
          inArray(
            documents.ownerId,
            invoices.map((i) => i.id),
          ),
        ),
      )
    : 0;
  return {
    name: sub.name,
    deletes: [
      invoices.length ? countOf(invoices.length, "invoice") : "",
      files ? countOf(files, "attached file") : "",
    ].filter(Boolean),
    keeps: linkedKeeps(
      await count(db, tasks, eq(tasks.subscriptionId, id)),
      await count(db, notes, eq(notes.subscriptionId, id)),
    ),
  };
}

/** Deletes a subscription with its invoices and their files. Returns the stored paths to remove. */
export async function deleteSubscription(
  tx: Tx,
  input: { id: string },
): Promise<{ name: string; paths: string[] }> {
  const { id } = idInput.parse(input);
  const [sub] = await tx
    .select({ name: subscriptions.name })
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .for("update");
  if (!sub) throw gone("subscription");
  const invoices = await tx
    .select({ id: subscriptionInvoices.id })
    .from(subscriptionInvoices)
    .where(eq(subscriptionInvoices.subscriptionId, id));
  const removed = invoices.length
    ? await tx
        .delete(documents)
        .where(
          and(
            eq(documents.ownerType, "subscription_invoice"),
            inArray(
              documents.ownerId,
              invoices.map((i) => i.id),
            ),
          ),
        )
        .returning({ storagePath: documents.storagePath })
    : [];
  // Invoices go by cascade; tasks, notes and checklist items that point here are set to null.
  await tx.delete(subscriptions).where(eq(subscriptions.id, id));
  await dropAlertStates(tx, [`renewal:${id}:%`, `cancel:${id}:%`]);
  return { name: sub.name, paths: removed.map((d) => d.storagePath) };
}

// ---------------------------------------------------------------------------
// Purchase order
// ---------------------------------------------------------------------------

export async function purchaseDeleteImpact(db: Db, input: { id: string }): Promise<RecordImpact> {
  const { id } = idInput.parse(input);
  const [po] = await db
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id));
  if (!po) throw gone("purchase");
  const lines = await count(db, poLines, eq(poLines.poId, id));
  const files = await count(
    db,
    documents,
    and(eq(documents.ownerType, "purchase_order"), eq(documents.ownerId, id)),
  );
  return {
    name: po.poNumber,
    deletes: [
      lines ? countOf(lines, "line item") : "",
      files ? countOf(files, "attached file") : "",
    ].filter(Boolean),
    keeps: linkedKeeps(
      await count(db, tasks, eq(tasks.poId, id)),
      await count(db, notes, eq(notes.poId, id)),
    ),
  };
}

/** Deletes a purchase with its lines and documents. Returns the stored paths to remove. */
export async function deletePurchase(
  tx: Tx,
  input: { id: string },
): Promise<{ name: string; paths: string[] }> {
  const { id } = idInput.parse(input);
  const [po] = await tx
    .select({ poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .for("update");
  if (!po) throw gone("purchase");
  const removed = await tx
    .delete(documents)
    .where(and(eq(documents.ownerType, "purchase_order"), eq(documents.ownerId, id)))
    .returning({ storagePath: documents.storagePath });
  // Lines go by cascade; tasks and notes that point here are set to null.
  await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  await dropAlertStates(tx, [`po:${id}`]);
  return { name: po.poNumber, paths: removed.map((d) => d.storagePath) };
}

// ---------------------------------------------------------------------------
// Stock item
// ---------------------------------------------------------------------------

/** Deletes a stock item outright (Retire stays as the soft option). */
export async function deleteStockItem(tx: Tx, input: { id: string }): Promise<{ name: string }> {
  const { id } = idInput.parse(input);
  const removed = await tx
    .delete(stockItems)
    .where(eq(stockItems.id, id))
    .returning({ tag: stockItems.tag });
  if (!removed.length) throw gone("stock item");
  return { name: removed[0]!.tag };
}

// ---------------------------------------------------------------------------
// Checklist (and, when nothing else refers to them, the person)
// ---------------------------------------------------------------------------

export type ChecklistImpact = RecordImpact & { deletesPerson: boolean };

async function checklistParts(db: Db, id: string) {
  const [checklist] = await db
    .select({
      personId: checklists.personId,
      kind: checklists.kind,
      fullName: people.fullName,
    })
    .from(checklists)
    .innerJoin(people, eq(people.id, checklists.personId))
    .where(eq(checklists.id, id));
  if (!checklist) throw gone("checklist");
  const items = await db
    .select({ id: checklistItems.id })
    .from(checklistItems)
    .where(eq(checklistItems.checklistId, id));
  const itemIds = items.map((i) => i.id);
  const generated = itemIds.length ? inArray(tasks.checklistItemId, itemIds) : undefined;
  const taskCount = generated ? await count(db, tasks, generated) : 0;

  // Does anything other than this checklist and the tasks it generated refer to the person?
  const otherChecklists = await count(
    db,
    checklists,
    and(eq(checklists.personId, checklist.personId), sql`${checklists.id} <> ${id}`),
  );
  const otherTasks = await count(
    db,
    tasks,
    and(
      eq(tasks.personId, checklist.personId),
      itemIds.length
        ? or(isNull(tasks.checklistItemId), notInArray(tasks.checklistItemId, itemIds))
        : undefined,
    ),
  );
  const noteRefs = await count(db, notes, eq(notes.personId, checklist.personId));
  const stockRefs = await count(
    db,
    stockItems,
    eq(stockItems.assignedPersonId, checklist.personId),
  );
  const keepPerson = otherChecklists + otherTasks + noteRefs + stockRefs > 0;
  return { checklist, itemIds, taskCount, keepPerson };
}

export async function checklistDeleteImpact(
  db: Db,
  input: { id: string },
): Promise<ChecklistImpact> {
  const { id } = idInput.parse(input);
  const { checklist, itemIds, taskCount, keepPerson } = await checklistParts(db, id);
  return {
    name: `the ${checklist.kind} checklist for ${checklist.fullName}`,
    deletes: [
      itemIds.length ? countOf(itemIds.length, "checklist item") : "",
      taskCount ? countOf(taskCount, "generated task") : "",
      keepPerson ? "" : `${checklist.fullName}’s person record`,
    ].filter(Boolean),
    keeps: keepPerson
      ? [`${checklist.fullName}’s person record stays, because other records refer to them.`]
      : [],
    deletesPerson: !keepPerson,
  };
}

/**
 * Deletes a checklist with its items and the tasks they generated. The person goes too only
 * when no other checklist, task, note or stock item refers to them.
 */
export async function deleteChecklist(
  tx: Tx,
  input: { id: string },
): Promise<{ name: string; personDeleted: boolean }> {
  const { id } = idInput.parse(input);
  await tx
    .select({ id: checklists.id })
    .from(checklists)
    .where(eq(checklists.id, id))
    .for("update");
  const { checklist, itemIds, keepPerson } = await checklistParts(tx, id);
  // The tasks would go by cascade with the items; deleting them first keeps the log in order.
  if (itemIds.length) await tx.delete(tasks).where(inArray(tasks.checklistItemId, itemIds));
  await tx.delete(checklists).where(eq(checklists.id, id));
  if (!keepPerson) await tx.delete(people).where(eq(people.id, checklist.personId));
  return {
    name: `the ${checklist.kind} checklist for ${checklist.fullName}`,
    personDeleted: !keepPerson,
  };
}

// ---------------------------------------------------------------------------
// One attached document
// ---------------------------------------------------------------------------

export const removePoDocumentInput = z.object({
  poId: z.uuid(),
  kind: z.enum(["invoice", "delivery_note", "approval"]),
});

/** Removes a PO's document of one kind (the slot shows Missing again). Returns the paths to delete. */
export async function removePoDocument(
  tx: Tx,
  input: z.input<typeof removePoDocumentInput>,
): Promise<string[]> {
  const data = removePoDocumentInput.parse(input);
  const removed = await tx
    .delete(documents)
    .where(
      and(
        eq(documents.ownerType, "purchase_order"),
        eq(documents.ownerId, data.poId),
        eq(documents.kind, data.kind),
      ),
    )
    .returning({ storagePath: documents.storagePath });
  if (!removed.length) throw gone("file");
  return removed.map((d) => d.storagePath);
}

/**
 * Removes a subscription invoice's file; the period goes back to missing (past) or upcoming
 * (future) by the usual rule. Returns the paths to delete.
 */
export async function removeInvoiceDocument(
  tx: Tx,
  input: { invoiceId: string },
  today: string,
): Promise<string[]> {
  const { invoiceId } = z.object({ invoiceId: z.uuid() }).parse(input);
  const [invoice] = await tx
    .select({ periodStart: subscriptionInvoices.periodStart })
    .from(subscriptionInvoices)
    .where(eq(subscriptionInvoices.id, invoiceId))
    .for("update");
  if (!invoice) throw gone("invoice");
  const removed = await tx
    .delete(documents)
    .where(and(eq(documents.ownerType, "subscription_invoice"), eq(documents.ownerId, invoiceId)))
    .returning({ storagePath: documents.storagePath });
  if (!removed.length) throw gone("file");
  await tx
    .update(subscriptionInvoices)
    .set({ documentId: null, status: invoiceStatusFor(invoice.periodStart, false, today) })
    .where(eq(subscriptionInvoices.id, invoiceId));
  return removed.map((d) => d.storagePath);
}

// ---------------------------------------------------------------------------
// Remove a period from the invoice ledger
// ---------------------------------------------------------------------------

/**
 * Removes a ledger period and its file (returns the storage paths to delete). Pro-rated rows
 * and anything that isn't a renewal are hard-deleted. A renewal row keeps a tiny `removed_at`
 * marker instead: ensureInvoicePeriods() recreates every missing renewal period on each page
 * load, so without the marker the period would simply reappear. The marker is hidden
 * everywhere and "Add invoice" for that month reuses it.
 */
export async function removeInvoicePeriod(
  tx: Tx,
  input: { invoiceId: string },
): Promise<{ periodLabel: string; paths: string[] }> {
  const { invoiceId } = z.object({ invoiceId: z.uuid() }).parse(input);
  const [invoice] = await tx
    .select({
      periodLabel: subscriptionInvoices.periodLabel,
      kind: subscriptionInvoices.kind,
    })
    .from(subscriptionInvoices)
    .where(and(eq(subscriptionInvoices.id, invoiceId), isNull(subscriptionInvoices.removedAt)))
    .for("update");
  if (!invoice) throw gone("period");
  const removed = await tx
    .delete(documents)
    .where(and(eq(documents.ownerType, "subscription_invoice"), eq(documents.ownerId, invoiceId)))
    .returning({ storagePath: documents.storagePath });
  if (invoice.kind === "renewal") {
    await tx
      .update(subscriptionInvoices)
      .set({ documentId: null, removedAt: new Date() })
      .where(eq(subscriptionInvoices.id, invoiceId));
  } else {
    await tx.delete(subscriptionInvoices).where(eq(subscriptionInvoices.id, invoiceId));
  }
  return { periodLabel: invoice.periodLabel, paths: removed.map((d) => d.storagePath) };
}
