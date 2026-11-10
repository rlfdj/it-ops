// Stock list writes: add units by hand (with a tag you type in) or by CSV import, edit
// them, check them out to a person (the row stays, status "deployed"), check them back
// in, or retire them. Stock is deliberately not in the activity log.

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { DomainError } from "../lib/domain-error.ts";
import { people, stockItems } from "../db/schema.ts";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

const tag = z
  .string()
  .trim()
  .min(1, "Every item needs a tag.")
  .max(60, "Tags can be up to 60 characters.");

const itemFields = {
  tag,
  model: z.string().trim().min(1, "Every item needs a model.").max(200),
  serialNumber: optionalText(100),
  specifications: optionalText(1000),
  notes: optionalText(1000),
};

export const addStockInput = z.object({
  items: z
    .array(z.object(itemFields))
    .min(1, "Add at least one item.")
    .max(100, "Add up to 100 at a time."),
});

export const updateStockInput = z.object({ id: z.uuid(), ...itemFields });

export const serialInput = z.object({ id: z.uuid(), serialNumber: optionalText(100) });

const idList = z.array(z.uuid()).min(1).max(500);

export const checkOutInput = z.object({
  ids: idList,
  issuedTo: z.string().trim().min(1, "Enter who it is issued to.").max(120),
  issuedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date.")
    .refine((d) => !Number.isNaN(Date.parse(d)), "Use a real date."),
  note: optionalText(500),
});
export const statusChangeInput = z.object({ ids: idList });

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "23505";

/** Turns the database's unique-tag error into a readable message. */
async function withTagCheck<T>(tags: string[], run: () => Promise<T>, tx: Tx): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const cause = (error as { cause?: unknown })?.cause ?? error;
    if (!isUniqueViolation(cause)) throw error;
    const taken = await tx
      .select({ tag: stockItems.tag })
      .from(stockItems)
      .where(inArray(stockItems.tag, tags));
    throw new DomainError(
      taken.length
        ? `Tag ${taken.map((t) => t.tag).join(", ")} is already in stock.`
        : "That tag is already in stock.",
    );
  }
}

/** Adds one or more items. Tags must be unique (within the batch and in stock). */
export async function addStock(tx: Tx, input: z.input<typeof addStockInput>): Promise<string[]> {
  const { items } = addStockInput.parse(input);
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.tag.toLowerCase();
    if (seen.has(key)) throw new DomainError(`Tag ${item.tag} is entered twice.`);
    seen.add(key);
  }
  const tags = items.map((i) => i.tag);
  // Check first so the error names the tags; the unique index still guards races.
  const taken = await tx
    .select({ tag: stockItems.tag })
    .from(stockItems)
    .where(inArray(stockItems.tag, tags));
  if (taken.length)
    throw new DomainError(`Tag ${taken.map((t) => t.tag).join(", ")} is already in stock.`);
  await withTagCheck(tags, () => tx.insert(stockItems).values(items), tx);
  return tags;
}

export async function updateStockItem(tx: Tx, input: z.input<typeof updateStockInput>) {
  const { id, ...data } = updateStockInput.parse(input);
  const [clash] = await tx
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(eq(stockItems.tag, data.tag));
  if (clash && clash.id !== id) throw new DomainError(`Tag ${data.tag} is already in stock.`);
  const updated = await withTagCheck(
    [data.tag],
    () =>
      tx.update(stockItems).set(data).where(eq(stockItems.id, id)).returning({ id: stockItems.id }),
    tx,
  );
  if (!updated.length) throw new DomainError("That item is no longer in stock.");
}

/** In-place serial edit from the table. */
export async function setStockSerial(tx: Tx, input: z.input<typeof serialInput>) {
  const data = serialInput.parse(input);
  const updated = await tx
    .update(stockItems)
    .set({ serialNumber: data.serialNumber })
    .where(eq(stockItems.id, data.id))
    .returning({ id: stockItems.id });
  if (!updated.length) throw new DomainError("That item is no longer in stock.");
}

/**
 * Checks in-stock units out to a person. The rows stay (status "deployed") with who has
 * them, since when, and a note. Returns the tags checked out.
 */
export async function checkOutStock(
  tx: Tx,
  input: z.input<typeof checkOutInput>,
): Promise<string[]> {
  const { ids, issuedTo, issuedOn, note } = checkOutInput.parse(input);
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(sql`lower(${people.fullName}) = lower(${issuedTo})`)
    .limit(1);
  const out = await tx
    .update(stockItems)
    .set({
      status: "deployed",
      issuedToName: issuedTo,
      assignedPersonId: person?.id ?? null,
      issuedOn,
      issueNote: note,
    })
    .where(and(inArray(stockItems.id, ids), eq(stockItems.status, "in_stock")))
    .returning({ tag: stockItems.tag });
  if (!out.length) throw new DomainError("Those items are no longer in stock.");
  return out.map((r) => r.tag);
}

/** Returns deployed or retired units to stock and clears who had them. Returns the tags. */
export async function checkInStock(
  tx: Tx,
  input: z.input<typeof statusChangeInput>,
): Promise<string[]> {
  const { ids } = statusChangeInput.parse(input);
  const back = await tx
    .update(stockItems)
    .set({
      status: "in_stock",
      issuedToName: null,
      assignedPersonId: null,
      issuedOn: null,
      issueNote: null,
    })
    .where(and(inArray(stockItems.id, ids), sql`${stockItems.status} <> 'in_stock'`))
    .returning({ tag: stockItems.tag });
  if (!back.length) throw new DomainError("Those items are already in stock.");
  return back.map((r) => r.tag);
}

/** Retires units (kept on the list, out of the in-stock count). Returns the tags. */
export async function retireStock(
  tx: Tx,
  input: z.input<typeof statusChangeInput>,
): Promise<string[]> {
  const { ids } = statusChangeInput.parse(input);
  const out = await tx
    .update(stockItems)
    .set({ status: "retired" })
    .where(and(inArray(stockItems.id, ids), sql`${stockItems.status} <> 'retired'`))
    .returning({ tag: stockItems.tag });
  if (!out.length) throw new DomainError("Those items are already retired.");
  return out.map((r) => r.tag);
}

// ---- CSV import (B-17, stock part) ----------------------------------------------------

export type ImportRow = {
  tag: string;
  model: string;
  serialNumber?: string | null;
  specifications?: string | null;
  notes?: string | null;
};
export type ImportCheck = { ok: boolean; errors: { row: number; message: string }[] };

const MAX_IMPORT = 500;
const importRowSchema = z.object(itemFields);

/** Checks every row: fields, tags repeated in the file, tags already on the stock list. */
export async function checkStockImport(tx: Tx, rows: ImportRow[]): Promise<ImportCheck> {
  if (rows.length === 0) return { ok: false, errors: [{ row: 0, message: "No rows to import." }] };
  if (rows.length > MAX_IMPORT)
    return {
      ok: false,
      errors: [{ row: 0, message: `Import up to ${MAX_IMPORT} rows at a time.` }],
    };
  const errors: ImportCheck["errors"] = [];
  const existing = new Set(
    (await tx.select({ tag: stockItems.tag }).from(stockItems)).map((r) => r.tag.toLowerCase()),
  );
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const row = i + 1;
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row, message: parsed.error.issues[0]?.message ?? "Invalid row." });
      return;
    }
    const key = parsed.data.tag.toLowerCase();
    if (seen.has(key))
      errors.push({ row, message: `Tag ${parsed.data.tag} repeats row ${seen.get(key)}.` });
    else if (existing.has(key))
      errors.push({ row, message: `Tag ${parsed.data.tag} is already on the stock list.` });
    else seen.set(key, row);
  });
  return { ok: errors.length === 0, errors };
}

/** Adds every row in one transaction, or none (any bad row fails the whole import). */
export async function importStock(tx: Tx, rows: ImportRow[]): Promise<number> {
  const check = await checkStockImport(tx, rows);
  if (!check.ok) {
    const first = check.errors[0]!;
    throw new DomainError(
      `${check.errors.length} problem${check.errors.length === 1 ? "" : "s"} found; nothing was imported. ${first.row ? `Row ${first.row}: ` : ""}${first.message}`,
    );
  }
  const items = rows.map((r) => importRowSchema.parse(r));
  await withTagCheck(
    items.map((i) => i.tag),
    () => tx.insert(stockItems).values(items),
    tx,
  );
  return items.length;
}
