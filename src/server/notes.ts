// Board (sticky note) writes. Everything takes a `tx` from withActor so the activity log
// records who did what; moving and resizing are saved without logging (see migration 0015).

import { and, count, eq, inArray, isNotNull, isNull, lt, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { documents, notes, people, purchaseOrders, subscriptions, tasks } from "../db/schema.ts";
import {
  DEFAULT_SIZE,
  MAX_ATTACHMENTS,
  MAX_CHECKLIST_LINES,
  MAX_LINE,
  MAX_TEXT,
  MAX_Z,
  NOTE_COLOURS,
  clampLayout,
  taskTitleFromNote,
  type ChecklistLine,
} from "../lib/board.ts";
import { DomainError } from "../lib/domain-error.ts";
import { createTask } from "./tasks.ts";

const colour = z.enum(NOTE_COLOURS);
const checklistLine = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(MAX_LINE),
  done: z.boolean(),
});
const checklist = z.array(checklistLine).max(MAX_CHECKLIST_LINES);
const noteId = z.uuid();

/** How long a deleted note waits (for Undo) before it and its files are removed for good. */
export const DELETED_NOTE_GRACE_MINUTES = 10;

export const newNoteInput = z.object({
  /** Chosen by the browser so the note appears at once and saves in the background. */
  id: noteId.optional(),
  x: z.coerce.number().default(24),
  y: z.coerce.number().default(24),
  width: z.coerce.number().default(DEFAULT_SIZE.width),
  height: z.coerce.number().default(DEFAULT_SIZE.height),
  colour: colour.default("yellow"),
  text: z.string().max(MAX_TEXT).default(""),
});

/** Adds a note, in front of the others. */
export async function createNote(tx: Tx, input: z.input<typeof newNoteInput>): Promise<string> {
  const data = newNoteInput.parse(input);
  const layout = clampLayout(data);
  const [top] = await tx.select({ z: max(notes.zIndex) }).from(notes);
  const [row] = await tx
    .insert(notes)
    .values({
      ...(data.id ? { id: data.id } : {}),
      ...layout,
      colour: data.colour,
      text: data.text,
      zIndex: Math.min(MAX_Z, (top?.z ?? 0) + 1),
    })
    .returning({ id: notes.id });
  return row!.id;
}

export const noteContentInput = z.object({
  id: noteId,
  text: z.string().max(MAX_TEXT, "A note can hold up to 10,000 characters.").optional(),
  colour: colour.optional(),
  checklist: checklist.optional(),
});

/** Saves what was typed or ticked: the text, checklist lines and colour (those given). */
export async function updateNoteContent(
  tx: Tx,
  input: z.input<typeof noteContentInput>,
): Promise<void> {
  const { id, ...data } = noteContentInput.parse(input);
  const set: Partial<typeof notes.$inferInsert> = {};
  if (data.text !== undefined) set.text = data.text;
  if (data.colour !== undefined) set.colour = data.colour;
  if (data.checklist !== undefined) set.checklist = data.checklist satisfies ChecklistLine[];
  if (!Object.keys(set).length) return;
  const updated = await tx
    .update(notes)
    .set(set)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
  if (!updated.length) throw new DomainError("That note no longer exists.");
}

export const noteLinkInput = z.object({
  id: noteId,
  related: z
    .object({ kind: z.enum(["po", "subscription", "person", "task"]), id: z.uuid() })
    .nullable(),
});

/** Links the note to one record (replacing any earlier link), or clears the link. */
export async function setNoteLink(tx: Tx, input: z.input<typeof noteLinkInput>): Promise<void> {
  const { id, related } = noteLinkInput.parse(input);
  type Link = Pick<typeof notes.$inferInsert, "personId" | "poId" | "subscriptionId" | "taskId">;
  const none: Link = { personId: null, poId: null, subscriptionId: null, taskId: null };
  let link: Link = none;
  if (related) {
    const { kind, id: recordId } = related;
    const [found] =
      kind === "po"
        ? await tx
            .select({ id: purchaseOrders.id })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, recordId))
        : kind === "subscription"
          ? await tx
              .select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.id, recordId))
          : kind === "person"
            ? await tx.select({ id: people.id }).from(people).where(eq(people.id, recordId))
            : await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, recordId));
    if (!found) throw new DomainError("That record no longer exists. Pick another or clear it.");
    link = {
      ...none,
      ...(kind === "po"
        ? { poId: recordId }
        : kind === "subscription"
          ? { subscriptionId: recordId }
          : kind === "person"
            ? { personId: recordId }
            : { taskId: recordId }),
    };
  }
  const updated = await tx
    .update(notes)
    .set(link)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
  if (!updated.length) throw new DomainError("That note no longer exists.");
}

const layoutItem = z.object({
  id: noteId,
  x: z.coerce.number(),
  y: z.coerce.number(),
  width: z.coerce.number(),
  height: z.coerce.number(),
  zIndex: z.coerce.number().int().min(0).max(MAX_Z),
});
export const noteLayoutsInput = z.array(layoutItem).max(200);

/**
 * Saves where notes sit, their size and stacking. Not written to the activity log. Notes
 * that were deleted meanwhile are skipped.
 */
export async function saveNoteLayouts(
  tx: Tx,
  input: z.input<typeof noteLayoutsInput>,
): Promise<void> {
  for (const item of noteLayoutsInput.parse(input)) {
    const { id, zIndex, ...rest } = item;
    await tx
      .update(notes)
      .set({ ...clampLayout(rest), zIndex })
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
  }
}

/** Hides the note; it is removed for good after DELETED_NOTE_GRACE_MINUTES (see purgeStale). */
export async function deleteNote(tx: Tx, input: { id: string }): Promise<void> {
  const id = noteId.parse(input.id);
  const updated = await tx
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .returning({ id: notes.id });
  if (!updated.length) throw new DomainError("That note is already gone.");
}

/** Undo for deleteNote. Safe to call twice; fails once the note has been removed for good. */
export async function restoreNote(tx: Tx, input: { id: string }): Promise<void> {
  const id = noteId.parse(input.id);
  const [row] = await tx.select({ deletedAt: notes.deletedAt }).from(notes).where(eq(notes.id, id));
  if (!row) throw new DomainError("The note was already removed, so it can’t be restored.");
  if (row.deletedAt === null) return;
  await tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, id));
}

/**
 * Removes deleted notes and their attached files for good: one note, or every one deleted
 * more than the grace period ago. Not logged again (the deletion was). Returns the storage
 * paths of the removed files so the caller can delete them from the bucket.
 */
export async function purgeDeletedNotes(
  tx: Tx,
  scope: { id: string } | { olderThanGrace: true },
): Promise<string[]> {
  const where =
    "id" in scope
      ? and(eq(notes.id, noteId.parse(scope.id)), isNotNull(notes.deletedAt))
      : and(
          isNotNull(notes.deletedAt),
          lt(notes.deletedAt, sql`now() - make_interval(mins => ${DELETED_NOTE_GRACE_MINUTES})`),
        );
  const gone = await tx.select({ id: notes.id }).from(notes).where(where);
  if (!gone.length) return [];
  const ids = gone.map((n) => n.id);
  await tx.execute(sql`select set_config('app.skip_activity_log', 'on', true)`);
  const removed = await tx
    .delete(documents)
    .where(and(eq(documents.ownerType, "note"), inArray(documents.ownerId, ids)))
    .returning({ storagePath: documents.storagePath });
  await tx.delete(notes).where(inArray(notes.id, ids));
  return removed.map((d) => d.storagePath);
}

/**
 * "Make task": a task titled with the note's text, linked to the note's PO, subscription
 * or person. Dates live on tasks, not notes, so the task has none. The note keeps a
 * pointer to the task it made.
 */
export async function makeTaskFromNote(
  tx: Tx,
  input: { id: string },
): Promise<{ taskId: string; title: string }> {
  const id = noteId.parse(input.id);
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
    .for("update");
  if (!note) throw new DomainError("That note no longer exists.");
  const title = taskTitleFromNote(note.text, note.checklist);
  if (!title) throw new DomainError("Write something on the note first; it becomes the task.");
  const taskId = await createTask(tx, {
    title,
    personId: note.personId,
    poId: note.poId,
    subscriptionId: note.subscriptionId,
  });
  await tx.update(notes).set({ madeTaskId: taskId }).where(eq(notes.id, id));
  return { taskId, title };
}

export const noteDocumentInput = z.object({
  noteId,
  storagePath: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

/** Records a file uploaded to a note (the caller has already put it in the bucket). */
export async function recordNoteDocument(
  tx: Tx,
  input: z.input<typeof noteDocumentInput>,
): Promise<{ id: string; fileName: string; sizeBytes: number }> {
  const data = noteDocumentInput.parse(input);
  const [note] = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, data.noteId), isNull(notes.deletedAt)))
    .for("update");
  if (!note) throw new DomainError("That note no longer exists.");
  const [have] = await tx
    .select({ n: count() })
    .from(documents)
    .where(and(eq(documents.ownerType, "note"), eq(documents.ownerId, data.noteId)));
  if ((have?.n ?? 0) >= MAX_ATTACHMENTS)
    throw new DomainError(`A note can hold up to ${MAX_ATTACHMENTS} files.`);
  const [doc] = await tx
    .insert(documents)
    .values({
      ownerType: "note",
      ownerId: data.noteId,
      kind: "other",
      storagePath: data.storagePath,
      fileName: data.fileName,
      originalName: data.fileName,
      sizeBytes: data.sizeBytes,
    })
    .returning({ id: documents.id, fileName: documents.fileName, sizeBytes: documents.sizeBytes });
  return doc!;
}

/** Removes one file from a note; returns its storage path for the caller to delete. */
export async function removeNoteDocument(tx: Tx, input: { id: string }): Promise<string> {
  const id = z.uuid().parse(input.id);
  const [doc] = await tx
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerType, "note")))
    .returning({ storagePath: documents.storagePath });
  if (!doc) throw new DomainError("That file is already gone.");
  return doc.storagePath;
}
