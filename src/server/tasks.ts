// Task writes. Checklist tasks stay in step with their checklist items (rule 5).

import { eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { DomainError } from "../lib/domain-error.ts";
import { people, purchaseOrders, subscriptions, tasks } from "../db/schema.ts";
import { parseQuickAdd } from "../lib/tasks.ts";
import { PO_NUMBER_PATTERN } from "../lib/ids.ts";
import { setItemDone } from "./checklists.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-13.");
const optionalDate = isoDate
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => v || null);
const STATUSES = ["open", "in_progress", "waiting", "done"] as const;
/** Free-text notes: trailing whitespace is dropped, at most 5000 characters. */
const notesText = z
  .string()
  .max(5000, "Notes can be up to 5000 characters.")
  .transform((v) => v.trimEnd());

export const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(300),
  dueDate: optionalDate,
  priority: z.coerce.number().int().min(1).max(3).default(2),
  status: z.enum(STATUSES).default("open"),
  personId: z.uuid().optional().nullable(),
  poId: z.uuid().optional().nullable(),
  subscriptionId: z.uuid().optional().nullable(),
  source: z.enum(["manual", "subscription", "system"]).default("manual"),
  notes: notesText.default(""),
});

/** Creates a task, optionally linked to a person, PO or subscription. */
export async function createTask(tx: Tx, input: z.input<typeof taskInput>): Promise<string> {
  const data = taskInput.parse(input);
  const [task] = await tx
    .insert(tasks)
    .values({ ...data, doneAt: data.status === "done" ? new Date() : null })
    .returning({ id: tasks.id });
  return task!.id;
}

export const newTaskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(300),
  dueDate: optionalDate,
  priority: z.coerce.number().int().min(1).max(3).default(2),
  status: z.enum(STATUSES).default("open"),
  notes: notesText.default(""),
  /** Optional link to one existing record. */
  related: z
    .object({ kind: z.enum(["po", "subscription", "person"]), id: z.uuid() })
    .optional()
    .nullable(),
});

/** The "New task" dialog: a task with the chosen fields, linked to an existing record if given. */
export async function addTask(tx: Tx, input: z.input<typeof newTaskInput>): Promise<string> {
  const data = newTaskInput.parse(input);
  const link: { personId?: string; poId?: string; subscriptionId?: string } = {};
  if (data.related) {
    const { kind, id } = data.related;
    const [found] =
      kind === "po"
        ? await tx
            .select({ id: purchaseOrders.id })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, id))
        : kind === "subscription"
          ? await tx
              .select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.id, id))
          : await tx.select({ id: people.id }).from(people).where(eq(people.id, id));
    if (!found) throw new DomainError("That record no longer exists. Pick another or clear it.");
    if (kind === "po") link.poId = id;
    else if (kind === "subscription") link.subscriptionId = id;
    else link.personId = id;
  }
  return createTask(tx, {
    title: data.title,
    dueDate: data.dueDate,
    priority: data.priority,
    status: data.status,
    notes: data.notes,
    ...link,
  });
}

export type RefLink = { personId?: string; poId?: string; subscriptionId?: string; label: string };

/**
 * Resolves a quick-add `#ref`: a PO number, else a subscription name, else a person's
 * name. Hyphens and underscores count as spaces (`#Karim-Saleh`, `#Microsoft_365`).
 */
export async function resolveRef(tx: Tx, ref: string): Promise<RefLink | null> {
  const upper = ref.toUpperCase();
  if (PO_NUMBER_PATTERN.test(upper)) {
    const [po] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.poNumber, upper));
    return po ? { poId: po.id, label: upper } : null;
  }
  const words = ref.replace(/[-_]+/g, " ").trim();
  if (!words) return null;
  const like = `%${words.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const [sub] = await tx
    .select({ id: subscriptions.id, name: subscriptions.name })
    .from(subscriptions)
    .where(ilike(subscriptions.name, like))
    .limit(1);
  if (sub) return { subscriptionId: sub.id, label: sub.name };
  const [person] = await tx
    .select({ id: people.id, name: people.fullName })
    .from(people)
    .where(or(ilike(people.fullName, like), ilike(people.email, like)))
    .limit(1);
  return person ? { personId: person.id, label: person.name } : null;
}

/** Quick add: "Chase invoice @fri #PO-2026-0153 !1". */
export async function quickAddTask(
  tx: Tx,
  input: { text: string },
  today: string,
): Promise<{ id: string; linked: string | null }> {
  const text = z.string().trim().min(1, "Type a task first.").max(400).parse(input.text);
  const parsed = parseQuickAdd(text, today);
  if (!parsed.title) throw new DomainError("Add a title as well as the shortcuts.");
  const link = parsed.ref ? await resolveRef(tx, parsed.ref) : null;
  if (parsed.ref && !link) throw new DomainError(`Nothing matches #${parsed.ref}.`);
  const id = await createTask(tx, {
    title: parsed.title,
    dueDate: parsed.dueDate,
    priority: parsed.priority,
    personId: link?.personId,
    poId: link?.poId,
    subscriptionId: link?.subscriptionId,
  });
  return { id, linked: link?.label ?? null };
}

export const taskDoneInput = z.object({ id: z.uuid(), done: z.boolean() });

/** Ticks a task. Checklist tasks tick their checklist item too (and vice versa). */
export async function setTaskDone(tx: Tx, input: z.input<typeof taskDoneInput>): Promise<void> {
  const { id, done } = taskDoneInput.parse(input);
  const [task] = await tx
    .select({ checklistItemId: tasks.checklistItemId, doneAt: tasks.doneAt })
    .from(tasks)
    .where(eq(tasks.id, id))
    .for("update");
  if (!task) throw new DomainError("Task not found.");
  if (task.checklistItemId) {
    await setItemDone(tx, { itemId: task.checklistItemId, done });
    return;
  }
  await tx
    .update(tasks)
    .set(
      done
        ? { status: "done", doneAt: task.doneAt ?? new Date() }
        : { status: "open", doneAt: null },
    )
    .where(eq(tasks.id, id));
}

const relatedInput = z
  .object({ kind: z.enum(["po", "subscription", "person"]), id: z.uuid() })
  .nullable();

export const taskUpdateInput = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Give the task a title.").max(300),
  dueDate: optionalDate,
  priority: z.coerce.number().int().min(1).max(3),
  status: z.enum(STATUSES),
  /** Leave it out to keep the current notes. */
  notes: notesText.optional(),
  /**
   * The record the task is linked to. Leave it out to keep the current link, send null to
   * clear it. Ignored for checklist tasks, whose link follows the checklist.
   */
  related: relatedInput.optional(),
});

/** The link columns for one chosen record (the other two are cleared), checking it exists. */
async function linkColumns(
  tx: Tx,
  related: z.infer<typeof relatedInput>,
): Promise<{ personId: string | null; poId: string | null; subscriptionId: string | null }> {
  const none = { personId: null, poId: null, subscriptionId: null };
  if (!related) return none;
  const { kind, id } = related;
  const [found] =
    kind === "po"
      ? await tx
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, id))
      : kind === "subscription"
        ? await tx
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(eq(subscriptions.id, id))
        : await tx.select({ id: people.id }).from(people).where(eq(people.id, id));
  if (!found) throw new DomainError("That record no longer exists. Pick another or clear it.");
  return kind === "po"
    ? { ...none, poId: id }
    : kind === "subscription"
      ? { ...none, subscriptionId: id }
      : { ...none, personId: id };
}

/** Edits a task. For checklist tasks the title and done state follow the item. */
export async function updateTask(tx: Tx, input: z.input<typeof taskUpdateInput>): Promise<void> {
  const data = taskUpdateInput.parse(input);
  const [task] = await tx
    .select({ checklistItemId: tasks.checklistItemId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, data.id))
    .for("update");
  if (!task) throw new DomainError("Task not found.");
  const wasDone = task.status === "done";
  const isDone = data.status === "done";
  await tx
    .update(tasks)
    .set({
      title: data.title,
      dueDate: data.dueDate,
      priority: data.priority,
      status: data.status,
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(isDone !== wasDone ? { doneAt: isDone ? new Date() : null } : {}),
      ...(data.related !== undefined && !task.checklistItemId
        ? await linkColumns(tx, data.related)
        : {}),
    })
    .where(eq(tasks.id, data.id));
  if (task.checklistItemId && isDone !== wasDone) {
    await setItemDone(tx, { itemId: task.checklistItemId, done: isDone });
    if (!isDone) await tx.update(tasks).set({ status: data.status }).where(eq(tasks.id, data.id));
  }
}

/** A deleted manual task, enough to put it back exactly as it was (for Undo). */
export const taskSnapshot = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(300),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  priority: z.number().int().min(1).max(3),
  status: z.enum(STATUSES),
  doneAt: z.coerce.date().nullable(),
  source: z.enum(["manual", "subscription", "system"]),
  personId: z.uuid().nullable(),
  poId: z.uuid().nullable(),
  subscriptionId: z.uuid().nullable(),
  /** Snapshots from before notes existed restore with none. */
  notes: z.string().max(5000).default(""),
  createdAt: z.coerce.date(),
});
export type TaskSnapshot = z.infer<typeof taskSnapshot>;

/** Deletes a manual task and returns what was removed. Checklist tasks go with their item. */
export async function deleteTask(tx: Tx, input: { id: string }): Promise<TaskSnapshot> {
  const { id } = z.object({ id: z.uuid() }).parse(input);
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw new DomainError("Task not found.");
  if (task.checklistItemId)
    throw new DomainError("This task belongs to a checklist — remove the checklist item instead.");
  await tx.delete(tasks).where(eq(tasks.id, id));
  return taskSnapshot.parse({ ...task, source: task.source });
}

/**
 * Undo for deleteTask: puts the task back under its original id. Idempotent — a second
 * call (or a retry) finds the task already there and does nothing. Links to records that
 * were removed in the meantime are dropped rather than failing the restore.
 */
export async function restoreTask(tx: Tx, input: z.input<typeof taskSnapshot>): Promise<void> {
  const data = taskSnapshot.parse(input);
  const [person] = data.personId
    ? await tx.select({ id: people.id }).from(people).where(eq(people.id, data.personId))
    : [];
  const [po] = data.poId
    ? await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, data.poId))
    : [];
  const [sub] = data.subscriptionId
    ? await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.id, data.subscriptionId))
    : [];
  await tx
    .insert(tasks)
    .values({
      ...data,
      personId: person?.id ?? null,
      poId: po?.id ?? null,
      subscriptionId: sub?.id ?? null,
    })
    .onConflictDoNothing({ target: tasks.id });
}

// ---------------------------------------------------------------------------
// Bulk edits (B-16): the selected tasks change together in one transaction.
// ---------------------------------------------------------------------------

const idList = z.array(z.uuid()).min(1, "Select at least one task.").max(200);

export const bulkTaskInput = z.object({
  ids: idList,
  change: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("done") }),
    z.object({ kind: z.literal("due"), dueDate: optionalDate }),
    z.object({ kind: z.literal("priority"), priority: z.coerce.number().int().min(1).max(3) }),
  ]),
});

/** What a task looked like before a bulk edit, enough to put it back (Undo). */
export const taskBefore = z.object({
  id: z.uuid(),
  status: z.enum(STATUSES),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  priority: z.number().int().min(1).max(3),
});
export type TaskBefore = z.infer<typeof taskBefore>;

/**
 * Marks selected tasks done, or sets their due date or priority. Tasks already in the target
 * state are left alone. Returns the previous state of the tasks that changed.
 */
export async function bulkUpdateTasks(
  tx: Tx,
  input: z.input<typeof bulkTaskInput>,
): Promise<{ changed: number; before: TaskBefore[] }> {
  const { ids, change } = bulkTaskInput.parse(input);
  const unique = [...new Set(ids)];
  const rows = await tx
    .select({
      id: tasks.id,
      status: tasks.status,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(inArray(tasks.id, unique))
    .for("update");
  if (rows.length !== unique.length)
    throw new DomainError("Some of these tasks no longer exist. Refresh and try again.");
  const before: TaskBefore[] = [];
  for (const t of rows) {
    if (change.kind === "done") {
      if (t.status === "done") continue;
      await setTaskDone(tx, { id: t.id, done: true });
    } else if (change.kind === "due") {
      if (t.dueDate === change.dueDate) continue;
      await tx.update(tasks).set({ dueDate: change.dueDate }).where(eq(tasks.id, t.id));
    } else {
      if (t.priority === change.priority) continue;
      await tx.update(tasks).set({ priority: change.priority }).where(eq(tasks.id, t.id));
    }
    before.push(t);
  }
  return { changed: before.length, before };
}

/** Undo for bulkUpdateTasks. Idempotent: it writes the earlier values back. */
export async function restoreTaskStates(
  tx: Tx,
  input: z.input<typeof taskBefore>[],
): Promise<void> {
  const states = z.array(taskBefore).max(200).parse(input);
  for (const s of states) {
    const [current] = await tx
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, s.id))
      .for("update");
    if (!current) continue; // deleted since
    if ((current.status === "done") !== (s.status === "done"))
      await setTaskDone(tx, { id: s.id, done: s.status === "done" });
    await tx
      .update(tasks)
      .set({
        dueDate: s.dueDate,
        priority: s.priority,
        ...(s.status !== "done" ? { status: s.status } : {}),
      })
      .where(eq(tasks.id, s.id));
  }
}

/** Deletes the manual tasks among the selection; checklist tasks are skipped, not deleted. */
export async function deleteTasks(
  tx: Tx,
  input: { ids: string[] },
): Promise<{ snapshots: TaskSnapshot[]; skipped: number }> {
  const ids = [...new Set(idList.parse(input.ids))];
  const rows = await tx
    .select({ id: tasks.id, checklistItemId: tasks.checklistItemId })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  const snapshots: TaskSnapshot[] = [];
  for (const t of rows) {
    if (t.checklistItemId) continue;
    snapshots.push(await deleteTask(tx, { id: t.id }));
  }
  return { snapshots, skipped: ids.length - snapshots.length };
}

/** Undo for deleteTasks. Idempotent, like restoreTask. */
export async function restoreTasks(
  tx: Tx,
  snapshots: z.input<typeof taskSnapshot>[],
): Promise<void> {
  for (const s of snapshots) await restoreTask(tx, s);
}
