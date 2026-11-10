"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { deleteConfirm, type DeleteConfirm } from "@/lib/delete-confirm";
import { checklistDeleteImpact, deleteChecklist } from "@/server/deletes";
import type { ActionResult } from "@/lib/uploads";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklistItem,
  restoreChecklistItem,
  setItemDone,
  setItemNotApplicable,
  updateChecklistItem,
  type addItemInput,
  type createChecklistInput,
  type itemSnapshot,
  type updateItemInput,
} from "@/server/checklists";

function refresh() {
  revalidatePath("/onboarding");
  revalidatePath("/tasks");
  revalidatePath("/", "layout");
}

async function run<T>(fn: (email: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    const data = await fn(user.email);
    refresh();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    return fail(error);
  }
}

export async function startChecklist(input: z.input<typeof createChecklistInput>) {
  return run((email) => withActor(email, (tx) => createChecklist(tx, input)));
}

export async function tickItem(itemId: string, done: boolean) {
  return run((email) => withActor(email, (tx) => setItemDone(tx, { itemId, done })));
}

export async function markNotApplicable(itemId: string, notApplicable: boolean) {
  return run((email) =>
    withActor(email, (tx) => setItemNotApplicable(tx, { itemId, notApplicable })),
  );
}

export async function addItem(input: z.input<typeof addItemInput>) {
  return run((email) => withActor(email, (tx) => addChecklistItem(tx, input)));
}

export async function editItem(input: z.input<typeof updateItemInput>) {
  return run((email) => withActor(email, (tx) => updateChecklistItem(tx, input)));
}

export async function removeItem(itemId: string) {
  return run((email) => withActor(email, (tx) => deleteChecklistItem(tx, { itemId })));
}

/** Undo for removeItem. Safe to call twice: the second call changes nothing. */
export async function undoRemoveItem(snapshot: z.input<typeof itemSnapshot>) {
  return run((email) => withActor(email, (tx) => restoreChecklistItem(tx, snapshot)));
}

/** What deleting a checklist takes with it (live counts), for the confirmation. */
export async function checklistDeletePreview(id: string): Promise<ActionResult<DeleteConfirm>> {
  try {
    await requireUser();
    return { ok: true, data: deleteConfirm(await checklistDeleteImpact(getDb(), { id })) };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a checklist with its items and generated tasks (and the person, if nothing else refers to them). */
export async function removeChecklist(id: string) {
  return run((email) => withActor(email, (tx) => deleteChecklist(tx, { id })));
}
