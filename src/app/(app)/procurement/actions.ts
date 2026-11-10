"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { deleteConfirm, type DeleteConfirm } from "@/lib/delete-confirm";
import { removeStoredFiles } from "@/lib/supabase/remove-files";
import {
  deletePurchase,
  purchaseDeleteImpact,
  removePoDocument,
  type removePoDocumentInput,
} from "@/server/deletes";
import { DomainError } from "@/lib/domain-error";
import { createClient } from "@/lib/supabase/server";
import { checkUpload, safeFileName, type ActionResult } from "@/lib/uploads";
import { PO_DOC_KINDS, type PoStage } from "@/lib/procurement";
import {
  advancePo,
  closeDeliveredPos,
  createPo,
  recordPoDocument,
  reopenClosedPos,
  setInvoiceDate,
  updatePo,
  type bulkPoInput,
  type invoiceDateInput,
  type poInput,
  type poUpdateInput,
} from "@/server/procurement";

const BUCKET = "documents";

function refresh() {
  revalidatePath("/procurement");
  revalidatePath("/", "layout");
}

export async function createPurchaseOrder(
  input: z.input<typeof poInput>,
): Promise<ActionResult<{ poNumber: string }>> {
  try {
    const user = await requireUser();
    const { poNumber } = await withActor(user.email, (tx) => createPo(tx, input));
    refresh();
    return { ok: true, data: { poNumber } };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePurchaseOrder(
  input: z.input<typeof poUpdateInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updatePo(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Moves a PO one stage forward (approved → ordered → delivered → closed). */
export async function advancePurchaseOrder(poId: string, to: PoStage): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => advancePo(tx, { poId, to }));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Closes several delivered purchases at once (all or nothing). */
export async function closePurchaseOrders(
  input: z.input<typeof bulkPoInput>,
): Promise<ActionResult<{ poNumbers: string[] }>> {
  try {
    const user = await requireUser();
    const data = await withActor(user.email, (tx) => closeDeliveredPos(tx, input));
    refresh();
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Undo for closePurchaseOrders. Safe to call twice. */
export async function undoClosePurchaseOrders(
  input: z.input<typeof bulkPoInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => reopenClosedPos(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Uploads a PO document (FormData: poId, kind, file) to the private bucket, then records
 * it. Attaching an approval to a requested PO moves it to approved.
 */
export async function attachPoDocument(
  formData: FormData,
): Promise<ActionResult<{ approved: boolean }>> {
  const supabase = await createClient();
  let uploadedPath: string | null = null;
  try {
    const user = await requireUser();
    const poId = z.uuid().parse(formData.get("poId"));
    const kind = z.enum(PO_DOC_KINDS).parse(formData.get("kind"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new DomainError("Choose a file to upload.");
    const problem = checkUpload(file);
    if (problem) throw new DomainError(problem);

    uploadedPath = `purchase-orders/${poId}/${kind}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedPath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new DomainError(`Upload failed: ${uploadError.message}`);

    const path = uploadedPath;
    const { approved, replacedPaths } = await withActor(user.email, (tx) =>
      recordPoDocument(tx, {
        poId,
        kind,
        storagePath: path,
        fileName: file.name.slice(0, 200),
        mimeType: file.type,
        sizeBytes: file.size,
        // Only the invoice carries a date; "" clears it, a missing field keeps it.
        invoiceDate:
          kind === "invoice" && typeof formData.get("invoiceDate") === "string"
            ? (formData.get("invoiceDate") as string)
            : undefined,
      }),
    );
    uploadedPath = null;

    if (replacedPaths.length) await supabase.storage.from(BUCKET).remove(replacedPaths);
    refresh();
    return { ok: true, data: { approved } };
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

/** Sets or clears a purchase's invoice date; its three file names follow. */
export async function setPurchaseInvoiceDate(
  input: z.input<typeof invoiceDateInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setInvoiceDate(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** What deleting a purchase takes with it (live counts), for the confirmation. */
export async function purchaseDeletePreview(id: string): Promise<ActionResult<DeleteConfirm>> {
  try {
    await requireUser();
    return { ok: true, data: deleteConfirm(await purchaseDeleteImpact(getDb(), { id })) };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a purchase with its lines and documents. */
export async function removePurchaseOrder(id: string): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const { name, paths } = await withActor(user.email, (tx) => deletePurchase(tx, { id }));
    await removeStoredFiles(paths);
    refresh();
    return { ok: true, data: { name } };
  } catch (error) {
    return fail(error);
  }
}

/** Removes one document from a purchase; its slot shows Missing again. */
export async function removePoFile(
  input: z.input<typeof removePoDocumentInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const paths = await withActor(user.email, (tx) => removePoDocument(tx, input));
    await removeStoredFiles(paths);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
