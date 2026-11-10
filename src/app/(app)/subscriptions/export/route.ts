import type { NextRequest } from "next/server";
import { csvDownload } from "@/lib/csv-response";
import { listSubscriptions } from "@/lib/queries/subscriptions";
import { filterRows, textParam } from "@/lib/list-view";
import { subSearchFields } from "@/lib/list-sorts";

/** Every subscription and contract as CSV; `?q=` limits it to the list's filter text (named so). */
export function GET(request: NextRequest) {
  const q = textParam(request.nextUrl.searchParams.get("q") ?? undefined);
  return csvDownload(
    request,
    q ? "subscriptions-filtered" : "subscriptions",
    async ({ currency }) => {
      const rows = filterRows(await listSubscriptions(), q, subSearchFields);
      return {
        header: [
          "Name",
          "Vendor",
          "Kind",
          "Plan",
          "Seats",
          "Billing",
          "Expected cost",
          "Currency",
          `Expected cost (${currency})`,
          "User",
          "Project",
          "Paid by",
          "Next charge",
          "Renewal",
          "Contract end",
          "Auto-renew",
          "Active",
          "Invoices on file",
          "Invoices missing",
          `Last paid (${currency})`,
          "Last paid date",
          "Last paid Standard seats",
          "Last paid Premium seats",
        ],
        rows: rows.map((s) => [
          s.name,
          s.vendor,
          s.kind === "contract" ? "Contract" : "Subscription",
          s.plan,
          s.seats,
          s.billingCycle === "yearly" ? "Yearly" : "Monthly",
          s.costOriginal,
          s.currency,
          s.costAed,
          s.userName,
          s.project,
          s.paidBy,
          s.nextChargeDate,
          s.renewalDate,
          s.contractEndDate,
          s.autoRenew ? "Yes" : "No",
          s.active ? "Yes" : "No",
          s.onFile,
          s.missing,
          s.lastPaidAed,
          s.lastPaidDate,
          s.lastPaidStandard,
          s.lastPaidPremium,
        ]),
      };
    },
  );
}
