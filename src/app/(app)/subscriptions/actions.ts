"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { actionFail as fail } from "@/lib/action-fail";
import { deleteConfirm, type DeleteConfirm } from "@/lib/delete-confirm";
import { removeStoredFiles } from "@/lib/supabase/remove-files";
import {
  deleteSubscription,
  removeInvoiceDocument,
  removeInvoicePeriod,
  subscriptionDeleteImpact,
} from "@/server/deletes";
import { DomainError } from "@/lib/domain-error";
import { createClient } from "@/lib/supabase/server";
import type { SubscriptionCsvRow } from "@/lib/subscription-import";
import type { SeatCsvRow } from "@/lib/seat-import";
import {
  addSeat,
  checkSeatImport,
  importSeats,
  removeSeat,
  updateSeat,
  type addSeatInput,
  type SeatImportCheck,
  type updateSeatInput,
} from "@/server/seats";
import { getToday } from "@/lib/queries/settings";
import { checkUpload, safeFileName, type ActionResult } from "@/lib/uploads";
import {
  addInvoicePeriod,
  checkSubscriptionImport,
  importSubscriptions,
  type SubscriptionImportCheck,
  createSubscription,
  recordInvoiceDocument,
  setAutoRenew,
  updateSubscription,
  type subscriptionInput,
  type subscriptionUpdateInput,
} from "@/server/subscriptions";

const BUCKET = "documents";

function refresh() {
  revalidatePath("/subscriptions");
  revalidatePath("/", "layout");
}

export async function saveNewSubscription(
  input: z.input<typeof subscriptionInput>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const { id } = await withActor(user.email, (tx) => createSubscription(tx, input));
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function saveSubscription(
  input: z.input<typeof subscriptionUpdateInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updateSubscription(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function toggleAutoRenew(id: string, autoRenew: boolean): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setAutoRenew(tx, { id, autoRenew }));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const optionalNumber = (v: FormDataEntryValue | null) =>
  v === null || v === "" ? null : Number(v);
const optionalString = (v: FormDataEntryValue | null) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** The pro-rated seat list from its JSON form field; `undefined` when absent or unreadable. */
function parseSeats(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Uploads an invoice file to a period (FormData: invoiceId, file, invoiceNumber?, amount,
 * seatsStandard? and seatsPremium? for tiered subscriptions) and marks it on file. With subscriptionId + periodStart instead of invoiceId, first adds
 * that period to the ledger ("Add invoice"; kind "prorated" also takes `seats`, a JSON list of
 * { personName, tier, project }); the file is then optional.
 */
export async function uploadInvoice(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  let uploadedPath: string | null = null;
  try {
    const user = await requireUser();
    const file = formData.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile) {
      const problem = checkUpload(file);
      if (problem) throw new DomainError(problem);
    }
    const invoiceNumber = optionalString(formData.get("invoiceNumber"));
    const amount = optionalNumber(formData.get("amount"));

    let invoiceId = optionalString(formData.get("invoiceId"));
    if (!invoiceId && !hasFile && !formData.get("subscriptionId"))
      throw new DomainError("Choose a file to upload.");

    if (hasFile) {
      const folder = invoiceId ?? `new-${crypto.randomUUID()}`;
      uploadedPath = `subscription-invoices/${folder}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (error) throw new DomainError(`Upload failed: ${error.message}`);
    }

    const path = uploadedPath;
    const today = await getToday();
    const replacedPaths = await withActor(user.email, async (tx) => {
      if (!invoiceId) {
        const created = await addInvoicePeriod(
          tx,
          {
            subscriptionId: String(formData.get("subscriptionId") ?? ""),
            kind: formData.get("kind") === "prorated" ? "prorated" : "renewal",
            periodStart: String(formData.get("periodStart") ?? ""),
            invoiceNumber,
            amountOriginal: amount ?? Number.NaN,
            seatsStandard: formData.get("seatsStandard")?.toString() ?? null,
            seatsPremium: formData.get("seatsPremium")?.toString() ?? null,
            seats: parseSeats(formData.get("seats")),
          },
          today,
        );
        invoiceId = created.id;
      } else if (!hasFile) {
        throw new DomainError("Choose a file to upload.");
      }
      if (!path || !hasFile) return [];
      const result = await recordInvoiceDocument(tx, {
        invoiceId,
        storagePath: path,
        fileName: file.name.slice(0, 200),
        mimeType: file.type,
        sizeBytes: file.size,
        invoiceNumber,
        amountOriginal: amount ?? Number.NaN,
        seatsStandard: formData.get("seatsStandard")?.toString() ?? null,
        seatsPremium: formData.get("seatsPremium")?.toString() ?? null,
      });
      return result.replacedPaths;
    });
    uploadedPath = null;
    if (replacedPaths.length) await supabase.storage.from(BUCKET).remove(replacedPaths);
    refresh();
    return { ok: true };
  } catch (error) {
    if (uploadedPath)
      await supabase.storage
        .from(BUCKET)
        .remove([uploadedPath])
        .catch(() => {});
    return fail(error);
  }
}

/** Dry run for the CSV import: per-row problems, nothing written. */
export async function previewSubscriptionImport(
  rows: SubscriptionCsvRow[],
): Promise<ActionResult<SubscriptionImportCheck>> {
  try {
    const user = await requireUser();
    const check = await withActor(user.email, (tx) => checkSubscriptionImport(tx, rows));
    return { ok: true, data: check };
  } catch (error) {
    return fail(error);
  }
}

export async function importSubscriptionRows(
  rows: SubscriptionCsvRow[],
): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const count = await withActor(user.email, (tx) => importSubscriptions(tx, rows));
    refresh();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error);
  }
}

/** What deleting a subscription takes with it (live counts), for the confirmation. */
export async function subscriptionDeletePreview(id: string): Promise<ActionResult<DeleteConfirm>> {
  try {
    await requireUser();
    return { ok: true, data: deleteConfirm(await subscriptionDeleteImpact(getDb(), { id })) };
  } catch (error) {
    return fail(error);
  }
}

/** Deletes a subscription with its invoices and their files. */
export async function removeSubscription(id: string): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const { name, paths } = await withActor(user.email, (tx) => deleteSubscription(tx, { id }));
    await removeStoredFiles(paths);
    refresh();
    return { ok: true, data: { name } };
  } catch (error) {
    return fail(error);
  }
}

/** Removes one invoice's file; the period goes back to missing or upcoming. */
export async function removeInvoiceFile(invoiceId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const today = await getToday();
    const paths = await withActor(user.email, (tx) =>
      removeInvoiceDocument(tx, { invoiceId }, today),
    );
    await removeStoredFiles(paths);
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Removes a period from the ledger (and its file). It isn't generated again. */
export async function removeInvoicePeriodAction(
  invoiceId: string,
): Promise<ActionResult<{ name: string }>> {
  try {
    const user = await requireUser();
    const { periodLabel, paths } = await withActor(user.email, (tx) =>
      removeInvoicePeriod(tx, { invoiceId }),
    );
    await removeStoredFiles(paths);
    refresh();
    return { ok: true, data: { name: periodLabel } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Seat roster (tiered subscriptions)
// ---------------------------------------------------------------------------

export async function addSeatAction(
  input: z.input<typeof addSeatInput>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const { id } = await withActor(user.email, (tx) => addSeat(tx, input));
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSeatAction(
  input: z.input<typeof updateSeatInput>,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => updateSeat(tx, input));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Ends a seat today; it stays in the past seats. */
export async function removeSeatAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const until = await getToday();
    await withActor(user.email, (tx) => removeSeat(tx, { id, until }));
    refresh();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Dry run for the seat import: per-row problems, nothing written. */
export async function previewSeatImport(
  subscriptionId: string,
  rows: SeatCsvRow[],
): Promise<ActionResult<SeatImportCheck>> {
  try {
    const user = await requireUser();
    const check = await withActor(user.email, (tx) => checkSeatImport(tx, subscriptionId, rows));
    return { ok: true, data: check };
  } catch (error) {
    return fail(error);
  }
}

export async function importSeatRows(
  subscriptionId: string,
  rows: SeatCsvRow[],
): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    const since = await getToday();
    const count = await withActor(user.email, (tx) =>
      importSeats(tx, { subscriptionId, rows, since }),
    );
    refresh();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error);
  }
}
