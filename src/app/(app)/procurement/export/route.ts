import type { NextRequest } from "next/server";
import { csvDownload } from "@/lib/csv-response";
import { DOC_LABEL, STAGE_LABEL } from "@/lib/procurement";
import { listPurchaseOrders } from "@/lib/queries/procurement";
import { filterRows, textParam } from "@/lib/list-view";
import { poSearchFields } from "@/lib/list-sorts";

const STATE = { ok: "Attached", miss: "Missing", na: "Not needed yet" } as const;

/**
 * Every PO as CSV, with its document states. `?q=` limits it to the purchases matching the
 * list's filter text and `?po=PO-…,PO-…` to selected ones; the file name says so.
 */
export function GET(request: NextRequest) {
  const q = textParam(request.nextUrl.searchParams.get("q") ?? undefined);
  const picked = (request.nextUrl.searchParams.get("po") ?? "").split(",").filter(Boolean);
  const name = picked.length
    ? "purchase-orders-selected"
    : q
      ? "purchase-orders-filtered"
      : "purchase-orders";
  return csvDownload(request, name, async ({ currency }) => {
    const all = await listPurchaseOrders();
    const rows = picked.length
      ? all.filter((p) => picked.includes(p.poNumber))
      : filterRows(all, q, poSearchFields);
    return {
      header: [
        "PO",
        "Requested",
        "Vendor",
        "Project",
        "Invoice number",
        "Status",
        "Items",
        `Subtotal (${currency})`,
        `Discount (${currency})`,
        `VAT 5% (${currency})`,
        `Total (${currency})`,
        "Invoice",
        "Delivery note",
        "Approval",
        "Missing",
      ],
      rows: rows.map((p) => [
        p.poNumber,
        p.requestedOn,
        p.vendor,
        p.project ?? "",
        p.invoiceNumber ?? "",
        STAGE_LABEL[p.status],
        p.summary,
        p.money.subtotal,
        p.money.discount,
        p.money.vat,
        p.totalAed,
        ...p.docs.map((d) => STATE[d.state]),
        p.missing.map((k) => DOC_LABEL[k]).join(", "),
      ]),
    };
  });
}
