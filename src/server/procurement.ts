// Procurement writes. Every function runs inside a caller-provided transaction (from
// withActor), so the activity log records the actor. Server actions add the session
// check, validation and file storage around these; integration tests call them directly.

import { and, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { DomainError } from "../lib/domain-error.ts";
import { documents, poLines, purchaseOrders, vendors } from "../db/schema.ts";
import { nextPoNumber } from "../db/sequences.ts";
import { todayIn } from "../lib/dates.ts";
import { getTimeZoneTx } from "./settings.ts";
import { fileExtension, poDocumentStem, uniqueDocumentName } from "../lib/document-names.ts";
import {
  DOC_LABEL,
  docList,
  lineTotal,
  missingToClose,
  nextManualStage,
  PO_DOC_KINDS,
  PO_STAGES,
  poTotal,
  stageAfterAttaching,
} from "../lib/procurement.ts";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-13.");

const lineSchema = z.object({
  id: z.uuid().optional(),
  description: z.string().trim().min(1, "Each line needs a description.").max(300),
  qty: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(10_000, "Quantity can be up to 10,000."),
  unitPriceAed: z.coerce.number().min(0, "Unit price can’t be negative.").max(10_000_000),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const poInput = z.object({
  vendorName: z.string().trim().min(1, "Choose or enter a vendor.").max(120),
  requestedOn: isoDate,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .transform((v) => v || null),
  invoiceNumber: optionalText(60),
  project: optionalText(120),
  vatApplied: z.boolean().optional().default(false),
  discountAed: z.coerce
    .number()
    .min(0, "The discount can’t be negative.")
    .max(10_000_000)
    .optional()
    .default(0),
  lines: z.array(lineSchema).min(1, "Add at least one line.").max(50),
});

/** The discount can't exceed what the lines add up to. */
function assertDiscount(data: z.output<typeof poInput>) {
  const subtotal = poTotal({ subtotal: data.lines.reduce((s, l) => s + lineTotal(l), 0) }).subtotal;
  if (data.discountAed > subtotal)
    throw new DomainError("The discount can’t be more than the subtotal.");
}

export const poUpdateInput = poInput.extend({ id: z.uuid(), status: z.enum(PO_STAGES) });

export const advanceInput = z.object({ poId: z.uuid(), to: z.enum(PO_STAGES) });

export const documentInput = z.object({
  poId: z.uuid(),
  kind: z.enum(PO_DOC_KINDS),
  storagePath: z.string().min(1).max(500),
  /** The uploaded file's own name; the stored name is built from the vendor, type and date. */
  fileName: z.string().min(1).max(200),
  mimeType: z.string().max(100).optional().nullable(),
  sizeBytes: z.number().int().min(1),
  /**
   * Invoice uploads only: the invoice date to save on the purchase ("" or null clears it,
   * left out keeps the current one). All three files are dated by it.
   */
  invoiceDate: z
    .union([isoDate, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

export const invoiceDateInput = z.object({
  poId: z.uuid(),
  invoiceDate: z.union([isoDate, z.literal(""), z.null()]).transform((v) => v || null),
});

/** Sets (or clears) the purchase's invoice date; the three file names follow it. */
export async function setInvoiceDate(
  tx: Tx,
  input: z.input<typeof invoiceDateInput>,
): Promise<void> {
  const data = invoiceDateInput.parse(input);
  const updated = await tx
    .update(purchaseOrders)
    .set({ invoiceDate: data.invoiceDate })
    .where(eq(purchaseOrders.id, data.poId))
    .returning({ id: purchaseOrders.id });
  if (!updated.length) throw new DomainError("Purchase not found.");
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A document name no other document has: `stem.ext`, else `stem-2.ext`, `stem-3.ext`, …
 * Call it after removing the document being replaced, so a replacement can reuse its name.
 */
export async function freeDocumentName(tx: Tx, stem: string, ext: string): Promise<string> {
  const like = `${stem.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = await tx
    .select({ fileName: documents.fileName })
    .from(documents)
    .where(ilike(documents.fileName, like));
  return uniqueDocumentName(
    stem,
    ext,
    rows.map((r) => r.fileName),
  );
}

/** Case-insensitive vendor lookup; creates the vendor if it doesn't exist. */
export async function vendorIdFor(tx: Tx, name: string): Promise<string> {
  const pattern = name.replace(/[\\%_]/g, (c) => "\\" + c);
  const [existing] = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(ilike(vendors.name, pattern));
  if (existing) return existing.id;
  const [created] = await tx.insert(vendors).values({ name }).returning({ id: vendors.id });
  return created!.id;
}

/** Creates a PO with the next number for the current year in the workspace time zone. */
export async function createPo(
  tx: Tx,
  input: z.input<typeof poInput>,
): Promise<{ id: string; poNumber: string }> {
  const data = poInput.parse(input);
  assertDiscount(data);
  const vendorId = await vendorIdFor(tx, data.vendorName);
  const poNumber = await nextPoNumber(tx);
  const [po] = await tx
    .insert(purchaseOrders)
    .values({
      poNumber,
      vendorId,
      requestedOn: data.requestedOn,
      notes: data.notes,
      invoiceNumber: data.invoiceNumber,
      project: data.project,
      vatApplied: data.vatApplied,
      discountAed: data.discountAed,
    })
    .returning({ id: purchaseOrders.id });
  await tx.insert(poLines).values(
    data.lines.map((l) => ({
      poId: po!.id,
      description: l.description,
      qty: l.qty,
      unitPriceAed: l.unitPriceAed,
    })),
  );
  return { id: po!.id, poNumber };
}

/** Edits a PO's header, stage and lines. */
export async function updatePo(tx: Tx, input: z.input<typeof poUpdateInput>): Promise<void> {
  const data = poUpdateInput.parse(input);
  assertDiscount(data);
  if (data.status === "closed") {
    const [current] = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, data.id));
    if (current && current.status !== "closed") await assertCanClose(tx, [data.id]);
  }
  const existing = await tx
    .select({ id: poLines.id })
    .from(poLines)
    .where(eq(poLines.poId, data.id));
  const existingIds = new Set(existing.map((l) => l.id));
  const keep = new Set(data.lines.flatMap((l) => (l.id ? [l.id] : [])));
  for (const l of data.lines) {
    if (l.id && !existingIds.has(l.id))
      throw new DomainError("A line doesn’t belong to this purchase.");
  }

  const updated = await tx
    .update(purchaseOrders)
    .set({
      vendorId: await vendorIdFor(tx, data.vendorName),
      requestedOn: data.requestedOn,
      notes: data.notes,
      invoiceNumber: data.invoiceNumber,
      project: data.project,
      vatApplied: data.vatApplied,
      discountAed: data.discountAed,
      status: data.status,
    })
    .where(eq(purchaseOrders.id, data.id))
    .returning({ id: purchaseOrders.id });
  if (!updated.length) throw new DomainError("Purchase not found.");

  const removed = existing.filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (removed.length) await tx.delete(poLines).where(inArray(poLines.id, removed));
  for (const l of data.lines) {
    const values = { description: l.description, qty: l.qty, unitPriceAed: l.unitPriceAed };
    if (l.id) await tx.update(poLines).set(values).where(eq(poLines.id, l.id));
    else await tx.insert(poLines).values({ ...values, poId: data.id });
  }
}

/**
 * Refuses to close purchases that are missing any of the approval, invoice and delivery note
 * (owner rule). Every route to Closed goes through this: the Close button, the bulk
 * "Close delivered" action and the status field in the Edit dialog.
 */
async function assertCanClose(tx: Tx, poIds: string[]): Promise<void> {
  if (!poIds.length) return;
  const [pos, docs] = await Promise.all([
    tx
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, poIds))
      .orderBy(purchaseOrders.poNumber),
    tx
      .select({ ownerId: documents.ownerId, kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.ownerType, "purchase_order"), inArray(documents.ownerId, poIds))),
  ]);
  const blocked = pos
    .map((p) => ({
      ...p,
      missing: missingToClose(docs.filter((d) => d.ownerId === p.id).map((d) => d.kind)),
    }))
    .filter((p) => p.missing.length);
  if (!blocked.length) return;
  if (pos.length === 1)
    throw new DomainError(`Upload ${docList(blocked[0]!.missing)} before closing this purchase.`);
  throw new DomainError(
    `All three documents are needed to close a purchase. Missing: ${blocked
      .map((b) => `${b.poNumber} (${b.missing.map((k) => DOC_LABEL[k].toLowerCase()).join(", ")})`)
      .join("; ")}.`,
  );
}

/** Moves a PO one stage forward (approved → ordered → delivered → closed). */
export async function advancePo(tx: Tx, input: z.input<typeof advanceInput>): Promise<void> {
  const { poId, to } = advanceInput.parse(input);
  const [po] = await tx
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .for("update");
  if (!po) throw new DomainError("Purchase not found.");
  if (nextManualStage(po.status) !== to) {
    throw new DomainError(
      po.status === "requested"
        ? "Attach the approval file to move this purchase to Approved."
        : "That stage change isn’t allowed.",
    );
  }
  if (to === "closed") await assertCanClose(tx, [poId]);
  await tx.update(purchaseOrders).set({ status: to }).where(eq(purchaseOrders.id, poId));
}

export const bulkPoInput = z.object({ poIds: z.array(z.uuid()).min(1).max(200) });

/**
 * Closes several delivered purchases in one transaction (B-16). Every one must be delivered,
 * so the one-step stage rule holds; otherwise nothing changes and the error names the rest.
 */
export async function closeDeliveredPos(
  tx: Tx,
  input: z.input<typeof bulkPoInput>,
): Promise<{ poNumbers: string[] }> {
  const poIds = [...new Set(bulkPoInput.parse(input).poIds)];
  const rows = await tx
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.id, poIds))
    .orderBy(purchaseOrders.poNumber)
    .for("update");
  if (rows.length !== poIds.length)
    throw new DomainError("Some of these purchases no longer exist. Refresh and try again.");
  const notDelivered = rows.filter((r) => r.status !== "delivered");
  if (notDelivered.length)
    throw new DomainError(
      `Only delivered purchases can be closed. Not delivered: ${notDelivered.map((r) => r.poNumber).join(", ")}.`,
    );
  await assertCanClose(tx, poIds);
  await tx
    .update(purchaseOrders)
    .set({ status: "closed" })
    .where(inArray(purchaseOrders.id, poIds));
  return { poNumbers: rows.map((r) => r.poNumber) };
}

/**
 * Undo for closeDeliveredPos: puts purchases that are still closed back to delivered.
 * Idempotent: ones already moved on are left alone.
 */
export async function reopenClosedPos(tx: Tx, input: z.input<typeof bulkPoInput>): Promise<void> {
  const { poIds } = bulkPoInput.parse(input);
  await tx
    .update(purchaseOrders)
    .set({ status: "delivered" })
    .where(and(inArray(purchaseOrders.id, poIds), eq(purchaseOrders.status, "closed")));
}

/**
 * Records an uploaded PO document, replacing any earlier one of the same kind.
 * Attaching an approval to a requested PO moves it to approved (business rule 1).
 * Returns the storage paths of replaced files so the caller can delete them.
 */
export async function recordPoDocument(
  tx: Tx,
  input: z.input<typeof documentInput>,
  today?: string,
): Promise<{ approved: boolean; replacedPaths: string[]; fileName: string }> {
  const data = documentInput.parse(input);
  const [po] = await tx
    .select({
      status: purchaseOrders.status,
      vendor: vendors.name,
      project: purchaseOrders.project,
      invoiceNumber: purchaseOrders.invoiceNumber,
      invoiceDate: purchaseOrders.invoiceDate,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(purchaseOrders.id, data.poId))
    .for("update", { of: purchaseOrders });
  if (!po) throw new DomainError("Purchase not found.");

  // An invoice upload carries the invoice date; every file is dated by it once it is set.
  let invoiceDate = po.invoiceDate;
  if (data.kind === "invoice" && data.invoiceDate !== undefined) {
    invoiceDate = data.invoiceDate;
    await tx.update(purchaseOrders).set({ invoiceDate }).where(eq(purchaseOrders.id, data.poId));
  }

  const previous = await tx
    .delete(documents)
    .where(
      and(
        eq(documents.ownerType, "purchase_order"),
        eq(documents.ownerId, data.poId),
        eq(documents.kind, data.kind),
      ),
    )
    .returning({ storagePath: documents.storagePath });

  // [Invoice-number_]Vendor_[Project_]Type_Date.ext (the date is the purchase's invoice date when set, else the attach date in the workspace time zone); -2, -3 … if that name is taken.
  const fileName = await freeDocumentName(
    tx,
    poDocumentStem(
      po.vendor,
      data.kind,
      invoiceDate ?? today ?? todayIn(await getTimeZoneTx(tx)),
      po.project,
      po.invoiceNumber,
    ),
    fileExtension(data.fileName, data.mimeType ?? undefined),
  );
  await tx.insert(documents).values({
    ownerType: "purchase_order",
    ownerId: data.poId,
    kind: data.kind,
    storagePath: data.storagePath,
    fileName,
    originalName: data.fileName,
    sizeBytes: data.sizeBytes,
  });

  const next = stageAfterAttaching(po.status, data.kind);
  if (next) {
    await tx.update(purchaseOrders).set({ status: next }).where(eq(purchaseOrders.id, data.poId));
  }
  return {
    approved: next === "approved",
    replacedPaths: previous.map((p) => p.storagePath),
    fileName,
  };
}
