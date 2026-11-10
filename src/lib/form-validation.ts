// Client-side field checks for the dialog forms (B-14). They mirror the zod schemas in
// src/server/*.ts so a mistake is shown beside its field before the round trip; the
// server still validates everything and remains the authority.

export type FieldErrors = Record<string, string>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const blank = (v: string | null | undefined) => !v || !v.trim();

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;

/** A plain decimal such as 1200 or 1200.50 (no thousands separators). */
export function parseDecimal(value: string): number | null {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

export function checkDate(value: string, label: string, required = true): string | null {
  if (blank(value)) return required ? `Enter the ${label}.` : null;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value)))
    return `Use a real date for the ${label}.`;
  return null;
}

/** Quantity: a whole number from 1 to 10,000. */
export function checkQty(value: string): string | null {
  if (blank(value)) return "Enter a quantity.";
  const n = parseDecimal(value);
  if (n === null || !Number.isInteger(n)) return "Use a whole number, like 2.";
  if (n < 1) return "Quantity must be at least 1.";
  if (n > 10_000) return "Quantity can be up to 10,000.";
  return null;
}

/** Money: a number from 0 up to `max`, e.g. 1200 or 1200.50. `label` reads "the cost". */
export function checkMoney(value: string, label: string, max = 100_000_000): string | null {
  if (blank(value)) return `Enter ${label}.`;
  const n = parseDecimal(value);
  if (n === null) return "Use a number like 1200.50.";
  if (n < 0) return "That can’t be negative.";
  if (n > max) return "That amount is too large.";
  return null;
}

/** Optional money: empty is fine. */
export function checkOptionalMoney(value: string, label: string): string | null {
  return blank(value) ? null : checkMoney(value, label);
}

export type PoFormInput = {
  vendorName: string;
  requestedOn: string;
  /** Optional discount as typed, and the lines' subtotal it can't exceed. */
  discount?: string;
  subtotal?: number;
  lines: { key: string; description: string; qty: string; unitPriceAed: string }[];
};

/** Keys: `vendor`, `date`, `discount`, and `line:<key>:description | qty | price`. */
export function validatePo(v: PoFormInput): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(v.vendorName)) errors.vendor = "Choose or enter a vendor.";
  const date = checkDate(v.requestedOn, "request date");
  if (date) errors.date = date;
  if (!blank(v.discount ?? "")) {
    const d = checkMoney(v.discount!, "a discount", 10_000_000);
    if (d) errors.discount = d;
    else if (v.subtotal !== undefined && Number(v.discount) > v.subtotal)
      errors.discount = "The discount can’t be more than the subtotal.";
  }
  for (const l of v.lines) {
    if (blank(l.description)) errors[`line:${l.key}:description`] = "Describe the item.";
    const qty = checkQty(l.qty);
    if (qty) errors[`line:${l.key}:qty`] = qty;
    const price = checkMoney(l.unitPriceAed, "a unit price", 10_000_000);
    if (price) errors[`line:${l.key}:price`] = price;
  }
  return errors;
}

export type SubFormInput = {
  name: string;
  vendorName: string;
  kind: "subscription" | "contract";
  seats: string;
  /** The expected cost: optional. */
  costOriginal: string;
  nextChargeDate: string;
  contractEndDate: string;
};

export function validateSub(v: SubFormInput): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(v.name)) errors.name = "Give it a name.";
  if (blank(v.vendorName)) errors.vendorName = "Choose or enter a vendor.";
  if (!blank(v.seats)) {
    const n = parseDecimal(v.seats);
    if (n === null || !Number.isInteger(n) || n < 0) errors.seats = "Use a whole number.";
  }
  const cost = checkOptionalMoney(v.costOriginal, "the expected cost");
  if (cost) errors.costOriginal = cost;
  const next = checkDate(v.nextChargeDate, "next charge date");
  if (next) errors.nextChargeDate = next;
  if (v.kind === "contract" && blank(v.contractEndDate)) {
    errors.contractEndDate = "Contracts need an end date.";
  } else {
    const end = checkDate(v.contractEndDate, "end date", false);
    if (end) errors.contractEndDate = end;
  }
  return errors;
}

/** Keys: `<rowKey>:tag | model`. Also flags a tag typed twice in the batch. */
export function validateStockRows(
  rows: { key: string; tag: string; model: string }[],
): FieldErrors {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  for (const r of rows) {
    const tag = r.tag.trim();
    if (!tag) errors[`${r.key}:tag`] = "Enter a tag.";
    else if (tag.length > 60) errors[`${r.key}:tag`] = "Tags can be up to 60 characters.";
    else {
      const key = tag.toLowerCase();
      if (seen.has(key)) errors[`${r.key}:tag`] = "This tag is entered twice.";
      seen.add(key);
    }
    if (blank(r.model)) errors[`${r.key}:model`] = "Enter a model.";
  }
  return errors;
}

export function validateStockItem(v: { tag: string; model: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(v.tag)) errors.tag = "Every item needs a tag.";
  else if (v.tag.trim().length > 60) errors.tag = "Tags can be up to 60 characters.";
  if (blank(v.model)) errors.model = "Every item needs a model.";
  return errors;
}

export function validateTask(v: { title: string; dueDate: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(v.title)) errors.title = "Give the task a title.";
  else if (v.title.trim().length > 300) errors.title = "Titles can be up to 300 characters.";
  const due = checkDate(v.dueDate, "due date", false);
  if (due) errors.dueDate = due;
  return errors;
}

export function validateChecklistItem(v: { label: string; dueDate?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (blank(v.label)) errors.label = "Enter a label.";
  else if (v.label.trim().length > 200) errors.label = "Labels can be up to 200 characters.";
  const due = checkDate(v.dueDate ?? "", "due date", false);
  if (due) errors.dueDate = due;
  return errors;
}

/**
 * An invoice upload. The amount is always required. Keys: `periodStart`, `amount`,
 * `seatsStandard`, `seatsPremium` (renewal invoices of tiered subscriptions),
 * `seats` and `seat:<key>:person` (pro-rated invoices: at least one seat, each with a person).
 */
export function validateInvoice(v: {
  periodStart?: string;
  amount: string;
  /** Renewal invoices of tiered subscriptions: the Standard and Premium counts as typed. */
  counts?: { standard: string; premium: string };
  /** Pro-rated invoices: the seat lines. */
  seats?: { key: string; personName: string }[];
}): FieldErrors {
  const errors: FieldErrors = {};
  if (v.seats) {
    if (v.seats.length === 0) errors.seats = "Add at least one seat.";
    for (const seat of v.seats)
      if (blank(seat.personName)) errors[`seat:${seat.key}:person`] = "Enter the person.";
  }
  if (v.counts) {
    for (const [key, raw] of [
      ["seatsStandard", v.counts.standard],
      ["seatsPremium", v.counts.premium],
    ] as const) {
      const n = parseDecimal(raw);
      if (n === null || !Number.isInteger(n) || n < 0) errors[key] = "Use a whole number.";
    }
  }
  if (v.periodStart !== undefined) {
    const d = checkDate(v.periodStart, "charge date");
    if (d) errors.periodStart = d;
  }
  const amount = checkMoney(v.amount, "the amount");
  if (amount) errors.amount = amount;
  return errors;
}

/** Keys: `date`, `name`, `item:<key>`. */
export function validateNewChecklist(v: {
  targetDate: string;
  newPerson: boolean;
  fullName: string;
  items: { key: string; label: string }[];
}): FieldErrors {
  const errors: FieldErrors = {};
  const date = checkDate(v.targetDate, "date");
  if (date) errors.date = date;
  if (v.newPerson && blank(v.fullName)) errors.name = "Enter the person’s name.";
  for (const i of v.items)
    if (blank(i.label)) errors[`item:${i.key}`] = "Every item needs a label.";
  return errors;
}

/** The errors without `key` — used to clear a field's message as soon as it is edited. */
export function without(errors: FieldErrors, key: string): FieldErrors {
  if (!(key in errors)) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}
