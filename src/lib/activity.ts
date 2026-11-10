// Turns raw activity-log rows into readable sentences. Pure functions.

import { actorName } from "./actor-name.ts";
import { MONTHS } from "./dates.ts";

export { actorName };

export type LogAction = "insert" | "update" | "delete";
export type Changes = Record<string, { old: unknown; new: unknown }>;

/** Extra facts the query looks up so sentences can link to the right record. */
export type LogContext = {
  /** For documents and PO lines: the PO number they belong to. */
  poNumber?: string | null;
  /** For subscriptions, invoices and invoice documents. */
  subscriptionId?: string | null;
  subscriptionName?: string | null;
  /** For checklists and checklist items. */
  checklistId?: string | null;
  personName?: string | null;
  checklistKind?: string | null;
};

export type LogEntry = {
  id: number;
  at: Date;
  actor: string;
  action: LogAction;
  tableName: string;
  recordId: string;
  recordLabel: string | null;
  module: string;
  changes: Changes;
  context?: LogContext;
};

export type Ref = { label: string; href: string | null; mono: boolean };

export type Sentence = {
  verb: string;
  ref: Ref | null;
  rest: string;
  change: { field: string; from: string; to: string } | null;
  /** A checklist item label inside `verb` (quoted there for the CSV); shown emphasised on screen. */
  item?: string;
};

const IGNORED = new Set(["id", "created_at", "updated_at", "search_vector"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/;

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  done_at: "Done",
  due_date: "Due",
  serial_number: "Serial",
  next_charge_date: "Next charge",
  renewal_date: "Renewal",
  contract_end_date: "Contract end",
  cost_original: "Expected cost",
  cost_aed: "Expected cost (base currency)",
  person_name: "Person",
  tier: "Seat",
  auto_renew: "Auto-renew",
  not_applicable: "Not applicable",
  requested_on: "Requested",
  vendor_id: "Vendor",
  person_id: "Person",
  po_id: "PO",
  subscription_id: "Subscription",
  unit_price_aed: "Unit price",
  qty: "Qty",
  invoice_number: "Invoice number",
  invoice_date: "Invoice date",
  discount_aed: "Discount",
  vat_applied: "5% VAT",
  amount_original: "Amount",
  amount_aed: "Amount (base currency)",
  document_id: "Document",
  target_date: "Target date",
  billing_cycle: "Billing",
  paid_by: "Paid by",
  assigned_to: "User",
  seats_standard: "Standard seats",
  seats_premium: "Premium seats",
};

/** "next_charge_date" → "Next charge". */
export const fieldLabel = (field: string) =>
  FIELD_LABEL[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Human value: dates as "13 Oct 2026", enums as words, booleans as Yes/No. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (typeof value === "string") {
    if (UUID.test(value)) return "(linked record)";
    if (ISO_DATE.test(value) || ISO_TIME.test(value)) {
      const [y, m, d] = value.slice(0, 10).split("-");
      return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    }
    if (
      /^[a-z]+(_[a-z]+)+$/.test(value) ||
      /^(requested|approved|ordered|delivered|closed|open|done|waiting|missing|upcoming|monthly|yearly|subscription|contract|assigned|retired|lost|reserved|cancelled|completed)$/.test(
        value,
      )
    ) {
      const words = value.replace(/_/g, " ");
      return words[0]!.toUpperCase() + words.slice(1);
    }
    return value;
  }
  return JSON.stringify(value);
}

/** The most telling change to show under the sentence (status first). */
export function primaryChange(changes: Changes): Sentence["change"] {
  const keys = Object.keys(changes).filter((k) => !IGNORED.has(k));
  const key = keys.find((k) => k === "status") ?? keys.find((k) => !k.endsWith("_id")) ?? keys[0];
  if (!key) return null;
  const c = changes[key]!;
  return { field: fieldLabel(key), from: formatValue(c.old), to: formatValue(c.new) };
}

const has = (changes: Changes, key: string) => Object.prototype.hasOwnProperty.call(changes, key);
const capitalise = (v: unknown) => {
  const s = typeof v === "string" ? v : "";
  return s ? s[0]!.toUpperCase() + s.slice(1) : "—";
};
const quote = (s: string | null | undefined) => `“${s ?? "item"}”`;

/** Builds the sentence for one log entry, e.g. "Moved PO-2026-0158 to Approved". */
export function describe(
  e: LogEntry,
  links: {
    po: (n: string) => string;
    subscription: (id: string) => string;
    checklist: (id: string) => string;
    person: (id: string) => string;
  },
): Sentence {
  const ctx = e.context ?? {};
  const label = e.recordLabel ?? "record";
  const change = e.action === "update" ? primaryChange(e.changes) : null;
  const statusTo = has(e.changes, "status") ? formatValue(e.changes.status!.new) : null;
  const poRef = (n: string | null | undefined): Ref | null =>
    n ? { label: n, href: links.po(n), mono: true } : null;
  const subRef = (): Ref | null =>
    ctx.subscriptionId
      ? {
          label: ctx.subscriptionName ?? label,
          href: links.subscription(ctx.subscriptionId),
          mono: false,
        }
      : null;
  const checklistRef = (): Ref | null =>
    ctx.checklistId
      ? {
          label: ctx.personName ?? "checklist",
          href: links.checklist(ctx.checklistId),
          mono: false,
        }
      : ctx.personName
        ? { label: ctx.personName, href: null, mono: false }
        : null;

  switch (e.tableName) {
    case "purchase_orders": {
      const ref = poRef(e.recordLabel);
      if (e.action === "insert") return { verb: "Created", ref, rest: "", change: null };
      if (e.action === "delete")
        return { verb: "Deleted", ref: { label, href: null, mono: true }, rest: "", change: null };
      if (statusTo) return { verb: "Moved", ref, rest: `to ${statusTo}`, change };
      return { verb: "Updated", ref, rest: "", change };
    }
    case "po_lines": {
      const line = (e.recordLabel ?? "").split(" · ").slice(1).join(" · ");
      const ref = poRef(ctx.poNumber ?? (e.recordLabel ?? "").split(" · ")[0]);
      const verb =
        e.action === "insert"
          ? "Added a line to"
          : e.action === "delete"
            ? "Removed a line from"
            : "Updated a line on";
      return { verb, ref, rest: line ? `· ${line}` : "", change };
    }
    case "documents": {
      const kind = formatValue(
        e.changes.kind?.new ?? e.changes.kind?.old ?? "document",
      ).toLowerCase();
      const name = e.recordLabel ?? "file";
      if ((e.changes.owner_type?.new ?? e.changes.owner_type?.old) === "note") {
        const board: Ref = { label: "a note", href: "/board", mono: false };
        return e.action === "delete"
          ? { verb: `Removed file ${name} from`, ref: board, rest: "", change: null }
          : { verb: `Attached file ${name} to`, ref: board, rest: "", change: null };
      }
      const ref = ctx.poNumber ? poRef(ctx.poNumber) : subRef();
      if (e.action === "delete")
        return { verb: `Removed ${kind} file ${name} from`, ref, rest: "", change: null };
      return { verb: `Attached ${kind} file ${name} to`, ref, rest: "", change: null };
    }
    case "subscriptions": {
      const ref: Ref = { label, href: links.subscription(e.recordId), mono: false };
      if (e.action === "insert") return { verb: "Added subscription", ref, rest: "", change: null };
      if (e.action === "delete")
        return {
          verb: "Deleted subscription",
          ref: { ...ref, href: null },
          rest: "",
          change: null,
        };
      if (
        has(e.changes, "next_charge_date") &&
        Object.keys(e.changes).every((k) => ["next_charge_date", "renewal_date"].includes(k))
      ) {
        return { verb: "Rolled", ref, rest: "to its next billing period", change };
      }
      return { verb: "Updated", ref, rest: "", change };
    }
    case "subscription_invoices": {
      const period = (e.recordLabel ?? "").split(" · ").slice(-1)[0] ?? "";
      const ref = subRef() ?? {
        label: (e.recordLabel ?? "").split(" · ")[0] ?? "subscription",
        href: null,
        mono: false,
      };
      if (e.action === "insert")
        return { verb: `Added the ${period} invoice period to`, ref, rest: "", change: null };
      if (statusTo === "On file")
        return { verb: `Filed the ${period} invoice for`, ref, rest: "", change };
      if (statusTo === "Missing")
        return { verb: `Flagged the ${period} invoice as missing for`, ref, rest: "", change };
      return { verb: `Updated the ${period} invoice for`, ref, rest: "", change };
    }
    case "prorated_seats": {
      // Label is "Subscription · Person"; the change carries the tier and project.
      const [subName, ...rest] = (e.recordLabel ?? "").split(" · ");
      const person = rest.join(" · ") || "a person";
      const tier = capitalise(e.changes.tier?.new ?? e.changes.tier?.old).toLowerCase();
      const ref: Ref = { label: subName || "subscription", href: null, mono: false };
      return e.action === "delete"
        ? { verb: `Removed ${person}’s ${tier} seat from`, ref, rest: "", change: null }
        : e.action === "insert"
          ? { verb: `Added a ${tier} seat for ${person} to`, ref, rest: "", change: null }
          : { verb: `Updated ${person}’s seat on`, ref, rest: "", change };
    }
    case "seat_assignments": {
      // Label is "Subscription · Person"; the change carries the tier, project and dates.
      const [subName, ...rest] = (e.recordLabel ?? "").split(" · ");
      const person = rest.join(" · ") || "a person";
      const ref: Ref = subRef() ?? { label: subName || "subscription", href: null, mono: false };
      const tier = capitalise(e.changes.tier?.new ?? e.changes.tier?.old).toLowerCase();
      if (e.action === "insert")
        return {
          verb:
            e.changes.source?.new === "import"
              ? `Imported a ${tier} seat for ${person} to`
              : `Added a ${tier} seat for ${person} to`,
          ref,
          rest: "",
          change: null,
        };
      if (e.action === "delete")
        return { verb: `Removed ${person}’s ${tier} seat from`, ref, rest: "", change: null };
      if (has(e.changes, "until"))
        return e.changes.until!.new
          ? {
              verb: `Ended ${person}’s seat on`,
              ref,
              rest: `· until ${formatValue(e.changes.until!.new)}`,
              change: null,
            }
          : { verb: `Restored ${person}’s seat on`, ref, rest: "", change: null };
      if (has(e.changes, "tier"))
        return {
          verb: `Changed ${person}’s seat to ${capitalise(e.changes.tier!.new)} on`,
          ref,
          rest: "",
          change: null,
        };
      return { verb: `Updated ${person}’s seat on`, ref, rest: "", change };
    }
    case "tasks": {
      const ref: Ref = { label: quote(e.recordLabel).slice(1, -1), href: "/tasks", mono: false };
      if (e.action === "insert") return { verb: "Created task", ref, rest: "", change: null };
      if (e.action === "delete")
        return { verb: "Deleted task", ref: { ...ref, href: null }, rest: "", change: null };
      if (statusTo === "Done") return { verb: "Completed task", ref, rest: "", change: null };
      // Only the notes changed: say so without printing the note text.
      if (
        Object.keys(e.changes)
          .filter((k) => !IGNORED.has(k))
          .join() === "notes"
      )
        return { verb: "Updated the notes on task", ref, rest: "", change: null };
      return { verb: "Updated task", ref, rest: "", change };
    }
    case "checklists": {
      const kind = String(e.changes.kind?.new ?? ctx.checklistKind ?? "").toLowerCase();
      const ref = checklistRef() ?? {
        label: (e.recordLabel ?? "").split(" · ")[0] ?? "",
        href: null,
        mono: false,
      };
      if (e.action === "insert")
        return { verb: `Started ${kind || "a"} checklist for`, ref, rest: "", change: null };
      if (statusTo === "Completed")
        return { verb: "Completed the checklist for", ref, rest: "", change: null };
      return { verb: "Updated the checklist for", ref, rest: "", change };
    }
    case "checklist_items": {
      const ref = checklistRef();
      const item = quote(e.recordLabel);
      const tail = ctx.checklistKind ? ctx.checklistKind : "";
      const itemLabel = e.recordLabel ?? "item";
      const s = (verb: string, c: Sentence["change"] = null): Sentence =>
        // The checklist may since have been deleted: drop the dangling "on" / "to" / "from".
        ref
          ? { verb, ref, rest: tail, change: c, item: itemLabel }
          : {
              verb: verb.replace(/ (on|to|from)$/, ""),
              ref: null,
              rest: "",
              change: c,
              item: itemLabel,
            };
      if (e.action === "insert") return s(`Added ${item} to`);
      if (e.action === "delete") return s(`Removed ${item} from`);
      if (has(e.changes, "done_at"))
        return s(e.changes.done_at!.new ? `Ticked ${item} on` : `Unticked ${item} on`);
      if (has(e.changes, "not_applicable"))
        return s(
          e.changes.not_applicable!.new
            ? `Marked ${item} not applicable on`
            : `Made ${item} applicable on`,
        );
      return s(`Edited ${item} on`, change);
    }
    case "notes": {
      const ref: Ref = { label, href: "/board", mono: false };
      if (e.action === "insert") return { verb: "Added note", ref, rest: "", change: null };
      if (e.action === "delete")
        return { verb: "Deleted note", ref: { ...ref, href: null }, rest: "", change: null };
      if (has(e.changes, "deleted_at"))
        return e.changes.deleted_at!.new
          ? { verb: "Deleted note", ref: { ...ref, href: null }, rest: "", change: null }
          : { verb: "Restored note", ref, rest: "", change: null };
      if (has(e.changes, "made_task_id") && e.changes.made_task_id!.new)
        return { verb: "Made a task from note", ref, rest: "", change: null };
      // The text and checklist can be long: show the colour change, otherwise just "Edited".
      const colour = e.changes.colour
        ? {
            field: "Colour",
            from: capitalise(e.changes.colour.old),
            to: capitalise(e.changes.colour.new),
          }
        : null;
      return { verb: "Edited note", ref, rest: "", change: colour };
    }
    case "people": {
      const ref: Ref = { label, href: links.person(e.recordId), mono: false };
      return {
        verb: e.action === "insert" ? "Added" : e.action === "delete" ? "Removed" : "Updated",
        ref,
        rest: "",
        change,
      };
    }
    case "vendors":
      return {
        verb: e.action === "insert" ? "Added vendor" : "Updated vendor",
        ref: { label, href: null, mono: false },
        rest: "",
        change,
      };
    case "checklist_templates": {
      // The steps are a JSON array: say what was edited instead of dumping it.
      const kind = e.recordLabel === "onboarding" ? "onboarding" : "offboarding";
      return { verb: `Updated the ${kind} template`, ref: null, rest: "", change: null };
    }
    default: {
      // Legacy rows (e.g. the old asset register) and anything else: generic wording.
      const verb =
        e.action === "insert" ? "Created" : e.action === "delete" ? "Deleted" : "Updated";
      return { verb, ref: { label, href: null, mono: /^[A-Z]{2}-/.test(label) }, rest: "", change };
    }
  }
}

/** Plain-text sentence (for CSV). */
export const sentenceText = (s: Sentence) =>
  [s.verb, s.ref?.label, s.rest].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date and time in `timeZone` (Dubai by default) for an instant. */
export function timeParts(
  at: Date,
  timeZone: string = "Asia/Dubai",
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Dubai calendar date and time for an instant (the default workspace zone). */
export const dubaiParts = (at: Date) => timeParts(at);

/** Day group heading: "Today · Tue 13 Oct", "Mon 12 Oct", "Fri 9 Oct 2025". */
export function dayLabel(date: string, today: string): string {
  const wd = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const base = `${wd} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  const label = date.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${date.slice(0, 4)}`;
  return date === today ? `Today · ${label}` : label;
}
