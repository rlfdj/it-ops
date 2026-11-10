// Reads a document's conventional name from current data (used at download time).

import { eq } from "drizzle-orm";
import type { AppDb, Tx } from "../db/actor.ts";
import {
  documents,
  proratedSeats,
  purchaseOrders,
  subscriptionInvoices,
  subscriptions,
  vendors,
} from "../db/schema.ts";
import { todayIn } from "../lib/dates.ts";
import { getTimeZoneTx } from "./settings.ts";
import { conventionalDocumentName } from "../lib/document-names.ts";

/**
 * `Vendor_Type_Date.ext` / `Name_Subscription_[User or Project]_…Invoice_….ext` for a
 * document, from the vendor, subscription (current user and project) and invoice row as
 * they are now. Null when the document doesn't exist.
 */
export async function documentDownloadName(db: AppDb | Tx, id: string): Promise<string | null> {
  const [doc] = await db
    .select({
      ownerType: documents.ownerType,
      ownerId: documents.ownerId,
      kind: documents.kind,
      fileName: documents.fileName,
      originalName: documents.originalName,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) return null;
  const timeZone = await getTimeZoneTx(db);

  if (doc.ownerType === "purchase_order") {
    const [po] = await db
      .select({
        vendor: vendors.name,
        project: purchaseOrders.project,
        invoiceNumber: purchaseOrders.invoiceNumber,
        invoiceDate: purchaseOrders.invoiceDate,
      })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .where(eq(purchaseOrders.id, doc.ownerId));
    if (!po) return doc.fileName;
    return conventionalDocumentName({
      owner: "purchase_order",
      kind: doc.kind,
      vendor: po.vendor,
      project: po.project,
      invoiceNumber: po.invoiceNumber,
      invoiceDate: po.invoiceDate,
      attachedOn: todayIn(timeZone, doc.uploadedAt),
      originalName: doc.originalName,
      storedName: doc.fileName,
    });
  }

  const [inv] = await db
    .select({
      kind: subscriptionInvoices.kind,
      periodStart: subscriptionInvoices.periodStart,
      invoiceNumber: subscriptionInvoices.invoiceNumber,
      rowUser: subscriptionInvoices.userName,
      rowProject: subscriptionInvoices.project,
      subscriptionName: subscriptions.name,
      userName: subscriptions.userName,
      project: subscriptions.project,
    })
    .from(subscriptionInvoices)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionInvoices.subscriptionId))
    .where(eq(subscriptionInvoices.id, doc.ownerId));
  if (!inv) return doc.fileName;
  const seats =
    inv.kind === "prorated"
      ? await db
          .select({ personName: proratedSeats.personName, project: proratedSeats.project })
          .from(proratedSeats)
          .where(eq(proratedSeats.invoiceId, doc.ownerId))
          .orderBy(proratedSeats.createdAt, proratedSeats.personName)
      : [];
  return conventionalDocumentName({
    owner: "subscription_invoice",
    subscriptionName: inv.subscriptionName,
    invoiceNumber: inv.invoiceNumber,
    userName: inv.userName,
    project: inv.project,
    invoice: {
      kind: inv.kind,
      periodStart: inv.periodStart,
      userName: inv.rowUser,
      project: inv.rowProject,
      seats,
    },
    originalName: doc.originalName,
    storedName: doc.fileName,
  });
}
