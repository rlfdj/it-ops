"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { deleteStockItem } from "@/server/deletes";
import type { ActionResult } from "@/lib/uploads";
import {
  addStock,
  checkInStock,
  checkOutStock,
  checkStockImport,
  importStock,
  retireStock,
  setStockSerial,
  updateStockItem,
  type addStockInput,
  type checkOutInput,
  type ImportCheck,
  type ImportRow,
  type serialInput,
  type statusChangeInput,
  type updateStockInput,
} from "@/server/stock";

function refresh() {
  revalidatePath("/stock");
  revalidatePath("/", "layout");
}

export async function addStockItems(
  input: z.input<typeof addStockInput>,
): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const user = await requireUser();
    const tags = await withActor(user.email, (tx) => addStock(tx, input));
    refresh();
    return { ok: true, data: { tags } };
  } catch (error) {
    return fail(error);
  }
}

export async function saveStockItem(
  input: z.input<typeof updateStockInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updateStockItem(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function saveStockSerial(input: z.input<typeof serialInput>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setStockSerial(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function checkOutStockItems(
  input: z.input<typeof checkOutInput>,
): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const user = await requireUser();
    const tags = await withActor(user.email, (tx) => checkOutStock(tx, input));
    refresh();
    return { ok: true, data: { tags } };
  } catch (error) {
    return fail(error);
  }
}

export async function checkInStockItems(
  input: z.input<typeof statusChangeInput>,
): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const user = await requireUser();
    const tags = await withActor(user.email, (tx) => checkInStock(tx, input));
    refresh();
    return { ok: true, data: { tags } };
  } catch (error) {
    return fail(error);
  }
}

export async function retireStockItems(
  input: z.input<typeof statusChangeInput>,
): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const user = await requireUser();
    const tags = await withActor(user.email, (tx) => retireStock(tx, input));
    refresh();
    return { ok: true, data: { tags } };
  } catch (error) {
    return fail(error);
  }
}

/** Dry run for the CSV import: per-row problems, nothing written. */
export async function previewStockImport(rows: ImportRow[]): Promise<ActionResult<ImportCheck>> {
  try {
    const user = await requireUser();
    const check = await withActor(user.email, (tx) => checkStockImport(tx, rows));
    return { ok: true, data: check };
  } catch (error) {
    return fail(error);
  }
}

export async function importStockRows(rows: ImportRow[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await withActor(user.email, (tx) => importStock(tx, rows));
    refresh();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a stock item outright (Retire keeps it on the list as retired). */
export async function removeStockItem(id: string): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const data = await withActor(user.email, (tx) => deleteStockItem(tx, { id }));
    refresh();
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}
