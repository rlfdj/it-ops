// On/offboarding checklist writes, kept in sync with their tasks (business rule 5):
// every open, applicable top-level item has a linked task; ticking either one completes
// both and records the date; not-applicable items have no task. Sub-items (each piece of
// equipment) roll up into their parent, which completes when they all do.

import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { DomainError } from "../lib/domain-error.ts";
import {
  checklistItems,
  checklists,
  people,
  seatAssignments,
  subscriptions,
  tasks,
} from "../db/schema.ts";
import { isSettled, itemDueDate, parentComplete, taskTitle } from "../lib/checklists.ts";
import { todayIn } from "../lib/dates.ts";
import { seatItemLabel } from "../lib/seat-roster.ts";
import type { SeatTier } from "../lib/subscription-seats.ts";
import { activeSeatsOfPerson, endSeat, restoreSeat } from "./seats.ts";
import { getTimeZoneTx } from "./settings.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-13.");
const optionalDate = isoDate
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);
const SECTIONS = ["accounts", "assets", "licences", "sim"] as const;

export const createChecklistInput = z.object({
  kind: z.enum(["onboarding", "offboarding"]),
  targetDate: isoDate,
  person: z.union([
    z.object({ id: z.uuid() }),
    z.object({
      fullName: z.string().trim().min(1, "Enter the person’s name.").max(120),
      department: optionalText(120),
      managerName: optionalText(120),
      email: z
        .email()
        .optional()
        .nullable()
        .or(z.literal(""))
        .transform((v) => v || null),
    }),
  ]),
  items: z
    .array(
      z.object({
        section: z.enum(SECTIONS),
        label: z.string().trim().min(1, "Every item needs a label.").max(200),
        detail: optionalText(300),
        dueDate: optionalDate,
        /** Pieces of equipment listed under this item. */
        children: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      }),
    )
    .min(1, "Add at least one item.")
    .max(60),
});

async function personName(tx: Tx, checklistId: string): Promise<{ id: string; name: string }> {
  const [row] = await tx
    .select({ id: people.id, name: people.fullName })
    .from(checklists)
    .innerJoin(people, eq(people.id, checklists.personId))
    .where(eq(checklists.id, checklistId));
  if (!row) throw new DomainError("Checklist not found.");
  return row;
}

/** Creates the linked task for a top-level, applicable, not-done item (if missing). */
async function ensureTask(
  tx: Tx,
  item: { id: string; label: string; dueDate: string | null; checklistId: string },
): Promise<void> {
  const person = await personName(tx, item.checklistId);
  await tx
    .insert(tasks)
    .values({
      title: taskTitle(item.label, person.name),
      dueDate: item.dueDate,
      priority: 2,
      status: "open",
      source: "checklist",
      checklistItemId: item.id,
      personId: person.id,
    })
    .onConflictDoNothing({ target: tasks.checklistItemId });
}

async function syncTaskDone(tx: Tx, itemId: string, doneAt: Date | null) {
  await tx
    .update(tasks)
    .set(doneAt ? { status: "done", doneAt } : { status: "open", doneAt: null })
    .where(eq(tasks.checklistItemId, itemId));
}

/** Marks the checklist completed when every top-level item is settled, else open. */
async function refreshChecklistStatus(tx: Tx, checklistId: string) {
  const top = await tx
    .select({ doneAt: checklistItems.doneAt, notApplicable: checklistItems.notApplicable })
    .from(checklistItems)
    .where(and(eq(checklistItems.checklistId, checklistId), isNull(checklistItems.parentId)));
  const complete = top.length > 0 && top.every(isSettled);
  const [current] = await tx
    .select({ status: checklists.status })
    .from(checklists)
    .where(eq(checklists.id, checklistId));
  if (!current || current.status === "cancelled") return;
  const next = complete ? "completed" : "open";
  if (current.status !== next) {
    await tx.update(checklists).set({ status: next }).where(eq(checklists.id, checklistId));
  }
}

/** Re-derives a parent's done state from its sub-items and syncs its task. */
async function refreshParent(tx: Tx, parentId: string) {
  const [parent] = await tx
    .select({
      id: checklistItems.id,
      doneAt: checklistItems.doneAt,
      notApplicable: checklistItems.notApplicable,
    })
    .from(checklistItems)
    .where(eq(checklistItems.id, parentId));
  if (!parent || parent.notApplicable) return;
  const children = await tx
    .select({ doneAt: checklistItems.doneAt, notApplicable: checklistItems.notApplicable })
    .from(checklistItems)
    .where(eq(checklistItems.parentId, parentId));
  const complete = parentComplete(children);
  if (complete && !parent.doneAt) {
    const at = new Date();
    await tx.update(checklistItems).set({ doneAt: at }).where(eq(checklistItems.id, parentId));
    await syncTaskDone(tx, parentId, at);
  } else if (!complete && parent.doneAt && children.length > 0) {
    await tx.update(checklistItems).set({ doneAt: null }).where(eq(checklistItems.id, parentId));
    await syncTaskDone(tx, parentId, null);
  }
}

async function loadItem(tx: Tx, itemId: string) {
  const [item] = await tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .for("update");
  if (!item) throw new DomainError("Checklist item not found.");
  return item;
}

// ---------------------------------------------------------------------------
// Public writes
// ---------------------------------------------------------------------------

export async function createChecklist(
  tx: Tx,
  input: z.input<typeof createChecklistInput>,
): Promise<{ checklistId: string; personId: string }> {
  const data = createChecklistInput.parse(input);

  let personId: string;
  if ("id" in data.person) {
    const [p] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.id, data.person.id));
    if (!p) throw new DomainError("That person doesn’t exist.");
    personId = p.id;
  } else {
    const [p] = await tx
      .insert(people)
      .values({
        fullName: data.person.fullName,
        department: data.person.department,
        managerName: data.person.managerName,
        email: data.person.email,
        status: "active",
        ...(data.kind === "onboarding" ? { startDate: data.targetDate } : {}),
      })
      .returning({ id: people.id });
    personId = p!.id;
  }
  if (data.kind === "offboarding") {
    await tx
      .update(people)
      .set({ status: "leaving", endDate: data.targetDate })
      .where(eq(people.id, personId));
  }

  const [checklist] = await tx
    .insert(checklists)
    .values({ personId, kind: data.kind, targetDate: data.targetDate })
    .returning({ id: checklists.id });

  for (const [sort, item] of data.items.entries()) {
    const dueDate = itemDueDate(item.dueDate, data.targetDate);
    const [row] = await tx
      .insert(checklistItems)
      .values({
        checklistId: checklist!.id,
        section: item.section,
        sort,
        label: item.label,
        detail: item.detail,
        dueDate,
      })
      .returning({ id: checklistItems.id });
    if (item.children.length) {
      await tx.insert(checklistItems).values(
        item.children.map((label, i) => ({
          checklistId: checklist!.id,
          parentId: row!.id,
          section: item.section,
          sort: i,
          label,
          dueDate,
        })),
      );
    }
    await ensureTask(tx, { id: row!.id, label: item.label, dueDate, checklistId: checklist!.id });
  }

  // Offboarding: one Accounts item per active seat the person holds (ticking it ends the seat).
  if (data.kind === "offboarding") {
    const [person] = await tx
      .select({ id: people.id, name: people.fullName, email: people.email })
      .from(people)
      .where(eq(people.id, personId));
    const seats = await activeSeatsOfPerson(tx, person!);
    for (const [i, seat] of seats.entries()) {
      const label = seatItemLabel(seat.subscriptionName, seat.tier as SeatTier);
      const dueDate = itemDueDate(null, data.targetDate);
      const [row] = await tx
        .insert(checklistItems)
        .values({
          checklistId: checklist!.id,
          section: "accounts",
          sort: data.items.length + i,
          label,
          detail: seat.project,
          dueDate,
          seatAssignmentId: seat.id,
        })
        .returning({ id: checklistItems.id });
      await ensureTask(tx, { id: row!.id, label, dueDate, checklistId: checklist!.id });
    }
  }
  return { checklistId: checklist!.id, personId };
}

export const itemDoneInput = z.object({ itemId: z.uuid(), done: z.boolean() });

/** Ticks or unticks a checklist item, keeping its task (and parent) in step. */
export async function setItemDone(tx: Tx, input: z.input<typeof itemDoneInput>): Promise<void> {
  const { itemId, done } = itemDoneInput.parse(input);
  const item = await loadItem(tx, itemId);
  if (item.notApplicable) throw new DomainError("This item is marked not applicable.");
  const at = done ? (item.doneAt ?? new Date()) : null;

  if (done) {
    // Ticking a parent ticks every outstanding piece under it.
    await tx
      .update(checklistItems)
      .set({ doneAt: at })
      .where(
        and(
          eq(checklistItems.parentId, itemId),
          isNull(checklistItems.doneAt),
          eq(checklistItems.notApplicable, false),
        ),
      );
  }
  await tx.update(checklistItems).set({ doneAt: at }).where(eq(checklistItems.id, itemId));
  await syncTaskDone(tx, itemId, at);
  if (item.seatAssignmentId) {
    // "Remove … seat" items: ticking ends the seat today; unticking brings it back.
    if (done && !item.doneAt)
      await endSeat(tx, item.seatAssignmentId, todayIn(await getTimeZoneTx(tx)));
    else if (!done && item.doneAt) await restoreSeat(tx, item.seatAssignmentId);
  }
  if (item.parentId) await refreshParent(tx, item.parentId);
  await refreshChecklistStatus(tx, item.checklistId);
}

export const itemNaInput = z.object({ itemId: z.uuid(), notApplicable: z.boolean() });

/** Not-applicable items have no task; making one applicable again restores its task. */
export async function setItemNotApplicable(tx: Tx, input: z.input<typeof itemNaInput>) {
  const { itemId, notApplicable } = itemNaInput.parse(input);
  const item = await loadItem(tx, itemId);
  await tx
    .update(checklistItems)
    .set({ notApplicable, ...(notApplicable ? { doneAt: null } : {}) })
    .where(eq(checklistItems.id, itemId));
  if (notApplicable) {
    await tx.delete(tasks).where(eq(tasks.checklistItemId, itemId));
  } else if (!item.parentId) {
    await ensureTask(tx, item);
  }
  if (item.parentId) await refreshParent(tx, item.parentId);
  await refreshChecklistStatus(tx, item.checklistId);
}

export const addItemInput = z.object({
  checklistId: z.uuid(),
  section: z.enum(SECTIONS),
  label: z.string().trim().min(1, "Enter a label.").max(200),
  detail: optionalText(300),
  dueDate: optionalDate,
  parentId: z.uuid().optional().nullable(),
});

/** Adds an item (or a piece of equipment under a parent item). */
export async function addChecklistItem(
  tx: Tx,
  input: z.input<typeof addItemInput>,
): Promise<{ id: string }> {
  const data = addItemInput.parse(input);
  const [checklist] = await tx
    .select({ targetDate: checklists.targetDate })
    .from(checklists)
    .where(eq(checklists.id, data.checklistId));
  if (!checklist) throw new DomainError("Checklist not found.");

  let section = data.section;
  let dueDate = itemDueDate(data.dueDate, checklist.targetDate);
  if (data.parentId) {
    const parent = await loadItem(tx, data.parentId);
    if (parent.checklistId !== data.checklistId || parent.parentId) {
      throw new DomainError(
        "Equipment can only be added under a top-level item of this checklist.",
      );
    }
    section = parent.section;
    dueDate = data.dueDate || parent.dueDate || dueDate;
  }
  const [{ last } = { last: null }] = await tx
    .select({ last: max(checklistItems.sort) })
    .from(checklistItems)
    .where(
      data.parentId
        ? eq(checklistItems.parentId, data.parentId)
        : and(eq(checklistItems.checklistId, data.checklistId), isNull(checklistItems.parentId)),
    );
  const [row] = await tx
    .insert(checklistItems)
    .values({
      checklistId: data.checklistId,
      parentId: data.parentId ?? null,
      section,
      sort: (last ?? -1) + 1,
      label: data.label,
      detail: data.detail,
      dueDate,
    })
    .returning({ id: checklistItems.id });

  if (data.parentId) await refreshParent(tx, data.parentId);
  else
    await ensureTask(tx, {
      id: row!.id,
      label: data.label,
      dueDate,
      checklistId: data.checklistId,
    });
  await refreshChecklistStatus(tx, data.checklistId);
  return { id: row!.id };
}

export const updateItemInput = z.object({
  itemId: z.uuid(),
  label: z.string().trim().min(1, "Enter a label.").max(200),
  detail: optionalText(300),
  dueDate: optionalDate,
});

/** Renames an item or changes its due date; the linked task follows. */
export async function updateChecklistItem(tx: Tx, input: z.input<typeof updateItemInput>) {
  const data = updateItemInput.parse(input);
  const item = await loadItem(tx, data.itemId);
  const [checklist] = await tx
    .select({ targetDate: checklists.targetDate })
    .from(checklists)
    .where(eq(checklists.id, item.checklistId));
  // Clearing the date puts it back to the checklist's target (the last day), never to "none".
  const dueDate = itemDueDate(data.dueDate, checklist!.targetDate);
  await tx
    .update(checklistItems)
    .set({ label: data.label, detail: data.detail, dueDate })
    .where(eq(checklistItems.id, data.itemId));
  const person = await personName(tx, item.checklistId);
  await tx
    .update(tasks)
    .set({ title: taskTitle(data.label, person.name), dueDate })
    .where(eq(tasks.checklistItemId, data.itemId));
}

const snapshotItem = z.object({
  id: z.uuid(),
  checklistId: z.uuid(),
  parentId: z.uuid().nullable(),
  section: z.enum(SECTIONS),
  sort: z.number().int(),
  label: z.string().min(1).max(200),
  detail: z.string().nullable(),
  subscriptionId: z.uuid().nullable(),
  seatAssignmentId: z.uuid().nullable().default(null),
  dueDate: z.string().nullable(),
  doneAt: z.coerce.date().nullable(),
  notApplicable: z.boolean(),
  createdAt: z.coerce.date(),
});
const snapshotTask = z.object({
  id: z.uuid(),
  title: z.string(),
  dueDate: z.string().nullable(),
  priority: z.number().int().min(1).max(3),
  status: z.enum(["open", "in_progress", "waiting", "done"]),
  doneAt: z.coerce.date().nullable(),
  source: z.enum(["manual", "checklist", "subscription", "system"]),
  checklistItemId: z.uuid().nullable(),
  personId: z.uuid().nullable(),
  poId: z.uuid().nullable(),
  subscriptionId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
});
/** A removed checklist item with its sub-items and tasks (for Undo). */
export const itemSnapshot = z.object({
  items: z.array(snapshotItem).min(1).max(100),
  tasks: z.array(snapshotTask).max(100),
});
export type ItemSnapshot = z.infer<typeof itemSnapshot>;

/** Removes an item (its sub-items and task go with it) and returns what was removed. */
export async function deleteChecklistItem(
  tx: Tx,
  input: { itemId: string },
): Promise<ItemSnapshot> {
  const { itemId } = z.object({ itemId: z.uuid() }).parse(input);
  const item = await loadItem(tx, itemId);
  const children = await tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.parentId, itemId))
    .orderBy(asc(checklistItems.sort));
  const items = [item, ...children];
  const removedTasks = await tx
    .select()
    .from(tasks)
    .where(
      inArray(
        tasks.checklistItemId,
        items.map((i) => i.id),
      ),
    );
  await tx.delete(checklistItems).where(eq(checklistItems.id, itemId));
  if (item.parentId) await refreshParent(tx, item.parentId);
  await refreshChecklistStatus(tx, item.checklistId);
  return itemSnapshot.parse({ items, tasks: removedTasks });
}

/**
 * Undo for deleteChecklistItem: re-inserts the item, its sub-items and its task(s) under
 * their original ids, then re-derives the parent and checklist state. Idempotent — if the
 * item is already back, nothing changes.
 */
export async function restoreChecklistItem(
  tx: Tx,
  input: z.input<typeof itemSnapshot>,
): Promise<void> {
  const data = itemSnapshot.parse(input);
  const top = data.items.find((i) => !data.items.some((o) => o.id === i.parentId));
  if (!top) throw new DomainError("Nothing to restore.");
  const [checklist] = await tx
    .select({ id: checklists.id })
    .from(checklists)
    .where(eq(checklists.id, top.checklistId));
  if (!checklist) throw new DomainError("The checklist was removed, so this item can’t come back.");
  if (top.parentId) {
    const [parent] = await tx
      .select({ id: checklistItems.id })
      .from(checklistItems)
      .where(eq(checklistItems.id, top.parentId));
    if (!parent) throw new DomainError("The item it belonged to was removed.");
  }
  // Parent first, so a sub-item's parent_id points at a row that exists.
  const ordered = [...data.items].sort(
    (a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)),
  );
  for (const row of ordered) {
    const [subscription] = row.subscriptionId
      ? await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.id, row.subscriptionId))
      : [];
    const [seat] = row.seatAssignmentId
      ? await tx
          .select({ id: seatAssignments.id })
          .from(seatAssignments)
          .where(eq(seatAssignments.id, row.seatAssignmentId))
      : [];
    await tx
      .insert(checklistItems)
      .values({
        ...row,
        subscriptionId: subscription?.id ?? null,
        seatAssignmentId: seat?.id ?? null,
      })
      .onConflictDoNothing({ target: checklistItems.id });
  }
  for (const task of data.tasks) {
    const [person] = task.personId
      ? await tx.select({ id: people.id }).from(people).where(eq(people.id, task.personId))
      : [];
    await tx
      .insert(tasks)
      .values({ ...task, personId: person?.id ?? null, poId: null, subscriptionId: null })
      .onConflictDoNothing({ target: tasks.id });
  }
  if (top.parentId) await refreshParent(tx, top.parentId);
  await refreshChecklistStatus(tx, top.checklistId);
}

/** Items of a checklist in display order (top-level, then their sub-items). */
export function checklistItemsOf(tx: Tx, checklistId: string) {
  return tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.checklistId, checklistId))
    .orderBy(asc(checklistItems.sort));
}
