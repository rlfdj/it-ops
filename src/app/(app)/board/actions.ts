"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { DomainError } from "@/lib/domain-error";
import { createClient } from "@/lib/supabase/server";
import { checkUpload, safeFileName, type ActionResult } from "@/lib/uploads";
import {
  attachmentOf,
  getNoteLink,
  listNoteLinkOptions,
  type NoteAttachment,
  type NoteLink,
  type NoteLinkOption,
} from "@/lib/queries/board";
import {
  createNote,
  deleteNote,
  makeTaskFromNote,
  purgeDeletedNotes,
  recordNoteDocument,
  removeNoteDocument,
  restoreNote,
  saveNoteLayouts,
  setNoteLink,
  updateNoteContent,
  type newNoteInput,
  type noteContentInput,
  type noteLayoutsInput,
  type noteLinkInput,
} from "@/server/notes";

const BUCKET = "documents";

/** Removes stored files; a failure only leaves an unreferenced file behind, so it is ignored. */
async function removeFiles(paths: string[]) {
  if (!paths.length) return;
  const supabase = await createClient();
  await supabase.storage
    .from(BUCKET)
    .remove(paths)
    .catch(() => {});
}

/**
 * The board changed in a way the Activity log shows. The board itself is not revalidated:
 * the open page holds the notes and a visit always loads them fresh.
 */
function refreshLogged() {
  revalidatePath("/activity");
}

export async function addNote(
  input: z.input<typeof newNoteInput>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const { id, stale } = await withActor(user.email, async (tx) => ({
      id: await createNote(tx, input),
      // Deleted notes whose Undo window has passed are cleaned up as the board is used.
      stale: await purgeDeletedNotes(tx, { olderThanGrace: true }),
    }));
    await removeFiles(stale);
    refreshLogged();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

/** Saves a note's text, checklist and colour as they are typed (the fields given). */
export async function saveNote(input: z.input<typeof noteContentInput>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updateNoteContent(tx, input));
    refreshLogged();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Saves positions and sizes after notes were moved or resized. Not logged. */
export async function saveLayouts(input: z.input<typeof noteLayoutsInput>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => saveNoteLayouts(tx, input));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveLink(
  input: z.input<typeof noteLinkInput>,
): Promise<ActionResult<{ link: NoteLink | null }>> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setNoteLink(tx, input));
    refreshLogged();
    return { ok: true, data: { link: await getNoteLink(input.id) } };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a note (hidden until its Undo window passes). */
export async function removeNote(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => deleteNote(tx, { id }));
    refreshLogged();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Undo for removeNote. Safe to call twice. */
export async function undoRemoveNote(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => restoreNote(tx, { id }));
    refreshLogged();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Removes a deleted note and its files for good, once Undo is no longer on offer. */
export async function purgeNote(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const paths = await withActor(user.email, (tx) => purgeDeletedNotes(tx, { id }));
    await removeFiles(paths);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function makeTask(
  id: string,
): Promise<ActionResult<{ taskId: string; title: string }>> {
  try {
    const user = await requireUser();
    const data = await withActor(user.email, (tx) => makeTaskFromNote(tx, { id }));
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Uploads a file (FormData: noteId, file) to the private bucket and attaches it to a note. */
export async function attachNoteFile(
  formData: FormData,
): Promise<ActionResult<{ attachment: NoteAttachment }>> {
  const supabase = await createClient();
  let uploadedPath: string | null = null;
  try {
    const user = await requireUser();
    const noteId = z.uuid().parse(formData.get("noteId"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new DomainError("Choose a file to upload.");
    const problem = checkUpload(file);
    if (problem) throw new DomainError(problem);

    uploadedPath = `notes/${noteId}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new DomainError(`Upload failed: ${uploadError.message}`);

    const path = uploadedPath;
    const doc = await withActor(user.email, (tx) =>
      recordNoteDocument(tx, {
        noteId,
        storagePath: path,
        fileName: file.name.slice(0, 200),
        sizeBytes: file.size,
      }),
    );
    uploadedPath = null;
    refreshLogged();
    return { ok: true, data: { attachment: attachmentOf(doc) } };
  } catch (error) {
    // Don't leave an orphaned file behind if recording it failed.
    if (uploadedPath)
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedPath])
        .catch(() => {});
    return fail(error);
  }
}

export async function removeNoteFile(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const path = await withActor(user.email, (tx) => removeNoteDocument(tx, { id }));
    await removeFiles([path]);
    refreshLogged();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** The records a note can be linked to (loaded when the Link dialog first opens). */
export async function loadNoteLinkOptions(): Promise<ActionResult<{ options: NoteLinkOption[] }>> {
  try {
    await requireUser();
    return { ok: true, data: { options: await listNoteLinkOptions() } };
  } catch (error) {
    return fail(error);
  }
}
