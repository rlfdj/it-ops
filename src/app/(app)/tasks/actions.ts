"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { getToday } from "@/lib/queries/settings";
import type { ActionResult } from "@/lib/uploads";
import { listTaskLinkOptions, type TaskLinkOption } from "@/lib/queries/tasks";
import {
  addTask,
  bulkUpdateTasks,
  deleteTask,
  deleteTasks,
  restoreTasks,
  restoreTaskStates,
  quickAddTask,
  restoreTask,
  setTaskDone,
  updateTask,
  type bulkTaskInput,
  type newTaskInput,
  type TaskBefore,
  type taskBefore,
  type TaskSnapshot,
  type taskSnapshot,
  type taskUpdateInput,
} from "@/server/tasks";

function refresh() {
  revalidatePath("/tasks");
  revalidatePath("/onboarding");
  revalidatePath("/", "layout");
}

export async function addQuickTask(
  text: string,
): Promise<ActionResult<{ id: string; linked: string | null }>> {
  try {
    const user = await requireUser();
    const today = await getToday();
    const { id, linked } = await withActor(user.email, (tx) => quickAddTask(tx, { text }, today));
    refresh();
    return { ok: true, data: { id, linked } };
  } catch (error) {
    return fail(error);
  }
}

/** The "New task" dialog. */
export async function createNewTask(
  input: z.input<typeof newTaskInput>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = await withActor(user.email, (tx) => addTask(tx, input));
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleTask(id: string, done: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setTaskDone(tx, { id, done }));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveTask(input: z.input<typeof taskUpdateInput>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updateTask(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a manual task. Returns a snapshot so the client can offer Undo. */
export async function removeTask(id: string): Promise<ActionResult<{ snapshot: TaskSnapshot }>> {
  try {
    const user = await requireUser();
    const snapshot = await withActor(user.email, (tx) => deleteTask(tx, { id }));
    refresh();
    return { ok: true, data: { snapshot } };
  } catch (error) {
    return fail(error);
  }
}

/** Undo for removeTask. Safe to call twice: the second call changes nothing. */
export async function undoRemoveTask(
  snapshot: z.input<typeof taskSnapshot>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => restoreTask(tx, snapshot));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Marks several tasks done, or sets their due date or priority, all or nothing. */
export async function bulkEditTasks(
  input: z.input<typeof bulkTaskInput>,
): Promise<ActionResult<{ changed: number; before: TaskBefore[] }>> {
  try {
    const user = await requireUser();
    const data = await withActor(user.email, (tx) => bulkUpdateTasks(tx, input));
    refresh();
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Undo for bulkEditTasks. Safe to call twice. */
export async function undoBulkEditTasks(
  before: z.input<typeof taskBefore>[],
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => restoreTaskStates(tx, before));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes the manual tasks among the selection; returns snapshots for Undo. */
export async function removeTasks(
  ids: string[],
): Promise<ActionResult<{ snapshots: TaskSnapshot[]; skipped: number }>> {
  try {
    const user = await requireUser();
    const data = await withActor(user.email, (tx) => deleteTasks(tx, { ids }));
    refresh();
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Undo for removeTasks. Safe to call twice. */
export async function undoRemoveTasks(
  snapshots: z.input<typeof taskSnapshot>[],
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => restoreTasks(tx, snapshots));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** The POs, subscriptions and people a task can be linked to (loaded when Edit opens). */
export async function loadTaskLinkOptions(): Promise<ActionResult<{ options: TaskLinkOption[] }>> {
  try {
    await requireUser();
    return { ok: true, data: { options: await listTaskLinkOptions() } };
  } catch (error) {
    return fail(error);
  }
}
