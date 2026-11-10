import type { NextRequest } from "next/server";
import { csvDownload } from "@/lib/csv-response";
import { formatDate } from "@/lib/dates";
import { listStock, parseStockView } from "@/lib/queries/stock";

const STATUS_LABEL = { in_stock: "In stock", deployed: "Deployed", retired: "Retired" } as const;

/** The stock list as CSV: the In stock list by default, or `?view=deployed|retired|all`. */
export function GET(request: NextRequest) {
  const view = parseStockView(request.nextUrl.searchParams.get("view") ?? undefined);
  return csvDownload(request, "stock", async ({ timeZone }) => ({
    header: [
      "Tag",
      "Model",
      "Serial number",
      "Specifications",
      "Notes",
      "Added",
      "Status",
      "Issued to",
      "Issued on",
    ],
    rows: (await listStock())
      .filter((s) => view === "all" || s.status === view)
      .map((s) => [
        s.tag,
        s.model,
        s.serialNumber,
        s.specifications,
        s.notes,
        formatDate(s.createdAt, timeZone),
        STATUS_LABEL[s.status],
        s.issuedToName,
        s.issuedOn ? formatDate(s.issuedOn) : null,
      ]),
  }));
}
