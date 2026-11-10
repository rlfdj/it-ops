// Turns a CSV file into subscription rows. Columns are matched by header name, so the
// Subscriptions export (Name, Vendor, Kind, Plan, Seats, Billing, Expected cost, Currency, ...) imports as it is.

import { parseCsv } from "./csv.ts";

export type SubscriptionCsvRow = {
  name: string;
  vendorName: string;
  kind: string;
  plan: string;
  seats: string;
  billingCycle: string;
  costOriginal: string;
  currency: string;
  userName: string;
  project: string;
  paidBy: string;
  nextChargeDate: string;
  contractEndDate: string;
  autoRenew: string;
  active: string;
};

const HEADERS: Record<keyof SubscriptionCsvRow, string[]> = {
  name: ["name", "subscription"],
  vendorName: ["vendor"],
  kind: ["kind", "type"],
  plan: ["plan"],
  seats: ["seats"],
  billingCycle: ["billing", "billing cycle", "cycle"],
  costOriginal: ["expected cost", "cost", "cost per period"],
  currency: ["currency"],
  userName: ["user"],
  project: ["project"],
  paidBy: ["paid by"],
  nextChargeDate: ["next charge", "next charge date"],
  contractEndDate: ["contract end", "contract ends", "contract end date"],
  autoRenew: ["auto-renew", "auto renew", "autorenew"],
  active: ["active"],
};

/** The CSV column name for each field, used in problem messages. */
export const SUBSCRIPTION_CSV_LABEL: Record<keyof SubscriptionCsvRow, string> = {
  name: "Name",
  vendorName: "Vendor",
  kind: "Kind",
  plan: "Plan",
  seats: "Seats",
  billingCycle: "Billing",
  costOriginal: "Expected cost",
  currency: "Currency",
  userName: "User",
  project: "Project",
  paidBy: "Paid by",
  nextChargeDate: "Next charge",
  contractEndDate: "Contract end",
  autoRenew: "Auto-renew",
  active: "Active",
};

export const SUBSCRIPTION_CSV_TEMPLATE =
  "Name,Vendor,Kind,Plan,Seats,Billing,Expected cost,Currency,User,Project,Paid by,Next charge,Contract end,Auto-renew,Active\r\n" +
  "Microsoft 365,Microsoft,Subscription,Business Standard,12,Monthly,540,AED,,,Corporate card,2026-11-05,,Yes,Yes\r\n" +
  "Office lease,Emaar,Contract,,,Yearly,48000,AED,,,Bank transfer,2026-12-01,2027-11-30,No,Yes\r\n";

const lower = (v: string) => v.trim().toLowerCase();
const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

/** Maps the loose spellings in a spreadsheet to the values the form uses; unknown text is kept so it fails with a message. */
function normalise(key: keyof SubscriptionCsvRow, value: string): string {
  const v = lower(value);
  if (key === "kind") return v === "" ? "subscription" : v;
  if (key === "billingCycle") return v === "" ? "monthly" : v;
  // A blank currency means the workspace base currency (filled in by toSubscriptionInput).
  if (key === "currency") return value.trim().toUpperCase();
  if (key === "autoRenew" || key === "active") {
    if (v === "") return "yes";
    return YES.has(v) ? "yes" : NO.has(v) ? "no" : v;
  }
  return value.trim();
}

/** Reads the header row and maps the data rows; an error message for an unusable file. */
export function parseSubscriptionCsv(
  text: string,
): { rows: SubscriptionCsvRow[] } | { error: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { error: "The file is empty." };
  const header = table[0]!.map(lower);
  const keys = Object.keys(HEADERS) as (keyof SubscriptionCsvRow)[];
  const index = {} as Record<keyof SubscriptionCsvRow, number>;
  for (const key of keys) index[key] = header.findIndex((h) => HEADERS[key].includes(h));
  const missing = (["name", "vendorName", "nextChargeDate"] as const).filter(
    (k) => index[k] === -1,
  );
  if (missing.length)
    return {
      error: `The first row must be a header. Missing column${missing.length === 1 ? "" : "s"}: ${missing.map((k) => SUBSCRIPTION_CSV_LABEL[k]).join(", ")}.`,
    };
  return {
    rows: table.slice(1).map((r) => {
      const row = {} as SubscriptionCsvRow;
      for (const key of keys)
        row[key] = normalise(key, index[key] === -1 ? "" : (r[index[key]] ?? ""));
      return row;
    }),
  };
}

/** The values the subscription form takes. */
export function toSubscriptionInput(r: SubscriptionCsvRow, baseCurrency: string = "AED") {
  const bool = (v: string) => (v === "yes" ? true : v === "no" ? false : v);
  return {
    name: r.name,
    vendorName: r.vendorName,
    kind: r.kind,
    plan: r.plan,
    seats: r.seats,
    billingCycle: r.billingCycle,
    costOriginal: r.costOriginal,
    currency: r.currency || baseCurrency,
    userName: r.userName,
    project: r.project,
    paidBy: r.paidBy,
    nextChargeDate: r.nextChargeDate,
    contractEndDate: r.contractEndDate,
    autoRenew: bool(r.autoRenew),
    active: bool(r.active),
  };
}
