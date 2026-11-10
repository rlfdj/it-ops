import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { todayIn } from "@/lib/dates";
import { getTimeZone } from "@/lib/queries/settings";
import { conventionalDocumentName } from "@/lib/document-names";
import { documents, poLines, poTotals, purchaseOrders, vendors } from "@/db/schema";
import {
  docStates,
  lineSummary,
  missingDocKinds,
  poTotal,
  type PoTotal,
  PO_DOC_KINDS,
  type PoDocKind,
  type PoStage,
} from "@/lib/procurement";

/**
 * SQL for a purchase's grand total, the same rule as `poTotal()`: the discount comes off the
 * lines' sum, then 5% VAT when ticked. (The `po_totals` view still holds the plain line sum.)
 */
const grandTotalSql = sql`(
  greatest(0, ${poTotals.totalAed} - ${purchaseOrders.discountAed})
  + case when ${purchaseOrders.vatApplied}
      then round(greatest(0, ${poTotals.totalAed} - ${purchaseOrders.discountAed}) * 0.05, 2)
      else 0 end
)`;

export type PoListRow = {
  id: string;
  poNumber: string;
  vendor: string;
  project: string | null;
  invoiceNumber: string | null;
  status: PoStage;
  requestedOn: string;
  /** The grand total: lines less the discount, plus VAT when applied. */
  totalAed: number;
  money: PoTotal;
  summary: string;
  docs: ReturnType<typeof docStates>;
  missing: PoDocKind[];
};

/** Every PO with its total, a line summary and document states, newest first. */
export async function listPurchaseOrders(): Promise<PoListRow[]> {
  const db = getDb();
  const [rows, lines, docs] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        vendor: vendors.name,
        project: purchaseOrders.project,
        invoiceNumber: purchaseOrders.invoiceNumber,
        status: purchaseOrders.status,
        requestedOn: purchaseOrders.requestedOn,
        subtotalAed: poTotals.totalAed,
        discountAed: purchaseOrders.discountAed,
        vatApplied: purchaseOrders.vatApplied,
      })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .innerJoin(poTotals, eq(poTotals.poId, purchaseOrders.id))
      .orderBy(desc(purchaseOrders.requestedOn), desc(purchaseOrders.poNumber)),
    db
      .select({ poId: poLines.poId, qty: poLines.qty, description: poLines.description })
      .from(poLines)
      .orderBy(asc(poLines.createdAt)),
    db
      .select({ ownerId: documents.ownerId, kind: documents.kind })
      .from(documents)
      .where(eq(documents.ownerType, "purchase_order")),
  ]);

  const linesByPo = Map.groupBy(lines, (l) => l.poId);
  const kindsByPo = Map.groupBy(docs, (d) => d.ownerId);

  return rows.map((r) => {
    const kinds = (kindsByPo.get(r.id) ?? []).map((d) => d.kind);
    const { subtotalAed, discountAed, vatApplied, ...rest } = r;
    const money = poTotal({ subtotal: subtotalAed, discount: discountAed, vat: vatApplied });
    return {
      ...rest,
      totalAed: money.total,
      money,
      summary: lineSummary(linesByPo.get(r.id) ?? []),
      docs: docStates(r.status, kinds),
      missing: missingDocKinds(r.status, kinds),
    };
  });
}

export type PoDocument = {
  id: string;
  kind: PoDocKind;
  /** The conventional name (`[Number_]Vendor_[Project_]Type_Date.ext`), computed from current data. */
  fileName: string;
  /** As uploaded; null for documents attached before files were renamed. */
  originalName: string | null;
  sizeBytes: number;
  uploadedAt: Date;
};

export type PoDetail = {
  id: string;
  poNumber: string;
  vendor: string;
  vendorId: string;
  project: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  status: PoStage;
  requestedOn: string;
  notes: string | null;
  vatApplied: boolean;
  discountAed: number;
  /** Subtotal, discount, VAT and grand total. */
  money: PoTotal;
  totalAed: number;
  lines: {
    id: string;
    description: string;
    qty: number;
    unitPriceAed: number;
  }[];
  documents: Partial<Record<PoDocKind, PoDocument>>;
};

export async function getPurchaseOrder(poNumber: string): Promise<PoDetail | null> {
  const db = getDb();
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      vendor: vendors.name,
      vendorId: purchaseOrders.vendorId,
      project: purchaseOrders.project,
      invoiceNumber: purchaseOrders.invoiceNumber,
      invoiceDate: purchaseOrders.invoiceDate,
      status: purchaseOrders.status,
      requestedOn: purchaseOrders.requestedOn,
      notes: purchaseOrders.notes,
      vatApplied: purchaseOrders.vatApplied,
      discountAed: purchaseOrders.discountAed,
      subtotalAed: poTotals.totalAed,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .innerJoin(poTotals, eq(poTotals.poId, purchaseOrders.id))
    .where(eq(purchaseOrders.poNumber, poNumber));
  if (!po) return null;
  const { subtotalAed, ...header } = po;
  const money = poTotal({ subtotal: subtotalAed, discount: po.discountAed, vat: po.vatApplied });

  const [lines, docs] = await Promise.all([
    db
      .select({
        id: poLines.id,
        description: poLines.description,
        qty: poLines.qty,
        unitPriceAed: poLines.unitPriceAed,
      })
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.createdAt)),
    db
      .select({
        id: documents.id,
        kind: documents.kind,
        fileName: documents.fileName,
        originalName: documents.originalName,
        sizeBytes: documents.sizeBytes,
        uploadedAt: documents.uploadedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.ownerType, "purchase_order"),
          eq(documents.ownerId, po.id),
          inArray(documents.kind, [...PO_DOC_KINDS]),
        ),
      )
      .orderBy(desc(documents.uploadedAt)),
  ]);

  const timeZone = await getTimeZone();
  const byKind: PoDetail["documents"] = {};
  for (const d of docs) {
    const kind = d.kind as PoDocKind;
    byKind[kind] ??= {
      ...d,
      kind,
      fileName: conventionalDocumentName({
        owner: "purchase_order",
        kind,
        vendor: po.vendor,
        project: po.project,
        invoiceNumber: po.invoiceNumber,
        invoiceDate: po.invoiceDate,
        attachedOn: todayIn(timeZone, d.uploadedAt),
        originalName: d.originalName,
        storedName: d.fileName,
      }),
    };
  }

  return { ...header, money, totalAed: money.total, lines, documents: byKind };
}

/** Header figures: open value, value ordered this quarter. */
export async function getProcurementTotals(quarter: { start: string; end: string }) {
  const db = getDb();
  const [row] = await db
    .select({
      openValue: sql<number>`coalesce(sum(${grandTotalSql}) filter (where ${purchaseOrders.status} <> 'closed'), 0)::float8`,
      spentQuarter: sql<number>`coalesce(sum(${grandTotalSql}) filter (
        where ${purchaseOrders.status} in ('ordered', 'delivered', 'closed')
          and ${purchaseOrders.requestedOn} between ${quarter.start} and ${quarter.end}
      ), 0)::float8`,
    })
    .from(purchaseOrders)
    .innerJoin(poTotals, eq(poTotals.poId, purchaseOrders.id));
  return { openValue: row?.openValue ?? 0, spentQuarter: row?.spentQuarter ?? 0 };
}

export async function listVendors() {
  return getDb()
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(asc(vendors.name));
}
