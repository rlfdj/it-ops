// Subscription rules. Pure functions (no I/O). Dates are `YYYY-MM-DD` calendar dates in the workspace time zone.

import { daysBetween, MONTHS } from "./dates.ts";
import { renewalDue } from "./dashboard.ts";

export type Cycle = "monthly" | "yearly";
export type Kind = "subscription" | "contract";
export type InvoiceStatus = "upcoming" | "missing" | "on_file";
export type Tone = "red" | "amber" | "grey";

/** Business rule 7: ≤ 14 days red, ≤ 30 days amber, later grey. */
export function urgency(days: number): Tone {
  if (days <= 14) return "red";
  if (days <= 30) return "amber";
  return "grey";
}

export type DecisionInput = {
  kind: Kind;
  billingCycle: Cycle;
  nextChargeDate: string | null;
  renewalDate: string | null;
  contractEndDate: string | null;
  autoRenew: boolean;
};

/** The date the owner has to act by: the renewal, the contract end or the next charge. */
export const decisionDate = (sub: DecisionInput): string | null => renewalDue(sub);

/**
 * Urgency keyed to the renewal. Contract ends and manual renewals follow the 14 / 30 day rule;
 * auto-renewing annual plans are never worse than amber; routine monthly auto-renew charges
 * stay grey.
 */
export function decisionTone(sub: DecisionInput, today: string): Tone {
  const date = decisionDate(sub);
  if (!date) return "grey";
  const base = urgency(daysBetween(today, date));
  if (sub.kind === "contract" || !sub.autoRenew) return base;
  if (sub.billingCycle === "monthly") return "grey";
  return base === "red" ? "amber" : base;
}

/** "in 6 days", "today", "tomorrow", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * Adds months to a date, pinning to `day` (the billing day) and clamping to the month's
 * length, so the 31st becomes the 30th in a 30-day month and back to the 31st after.
 */
export function addMonths(date: string, months: number, day = Number(date.slice(8, 10))): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mm = String(month + 1).padStart(2, "0");
  return `${year}-${mm}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export const nextPeriod = (cycle: Cycle, date: string, billingDay?: number | null) =>
  addMonths(date, cycle === "yearly" ? 12 : 1, billingDay ?? Number(date.slice(8, 10)));

/** `Sep 2026` for monthly periods, `2026` for yearly ones. */
export const periodLabel = (cycle: Cycle, date: string) =>
  cycle === "yearly"
    ? date.slice(0, 4)
    : `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/** `Pro-rated · 14 Oct` for a pro-rated invoice's charge date. */
export const proratedLabel = (date: string) =>
  `Pro-rated · ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]!.slice(0, 3)}`;

/** "Sep ’26" — compact label for the invoice ledger. */
export const shortPeriodLabel = (cycle: Cycle, date: string) =>
  cycle === "yearly"
    ? date.slice(0, 4)
    : `${MONTHS[Number(date.slice(5, 7)) - 1]} ’${date.slice(2, 4)}`;

const ORDINAL = (n: number) => {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${s}`;
};

/** "Monthly, on the 19th" or "Yearly, on 24 Oct". */
export function billingLabel(
  cycle: Cycle,
  billingDay: number | null,
  nextCharge: string | null,
): string {
  if (cycle === "monthly") return billingDay ? `Monthly, on the ${ORDINAL(billingDay)}` : "Monthly";
  if (!nextCharge) return "Yearly";
  return `Yearly, on ${Number(nextCharge.slice(8, 10))} ${MONTHS[Number(nextCharge.slice(5, 7)) - 1]}`;
}

// ---------------------------------------------------------------------------
// ensureInvoicePeriods (business rule 4)
// ---------------------------------------------------------------------------

export type RolloverInput = {
  cycle: Cycle;
  billingDay: number | null;
  nextChargeDate: string;
  contractEndDate: string | null;
  autoRenew: boolean;
};

export type RolloverPlan = {
  /** Charges that have now happened (period starts before today), oldest first. */
  passed: string[];
  /** The period to keep an `upcoming` row for, or null once a contract has ended. */
  upcoming: string | null;
  /** New `next_charge_date` (unchanged if nothing passed). */
  nextChargeDate: string;
};

/**
 * Works out which billing periods have passed and what the next one is.
 * A charge counts as passed the day after its date, so it can be filed on the day.
 * Contracts that don't auto-renew stop producing periods after their end date.
 */
export function planRollover(sub: RolloverInput, today: string): RolloverPlan {
  const passed: string[] = [];
  let next = sub.nextChargeDate;
  const ended = (d: string) =>
    Boolean(sub.contractEndDate && !sub.autoRenew && d > sub.contractEndDate);
  // Guard against runaway loops on bad data (10 years of monthly periods).
  for (let i = 0; i < 120 && next < today && !ended(next); i++) {
    passed.push(next);
    next = nextPeriod(sub.cycle, next, sub.billingDay);
  }
  return { passed, upcoming: ended(next) ? null : next, nextChargeDate: next };
}

/**
 * Invoice rows whose period has passed without a document are missing; upcoming rows
 * stay upcoming until their date has passed.
 */
export function invoiceStatusFor(
  periodStart: string,
  hasDocument: boolean,
  today: string,
): InvoiceStatus {
  if (hasDocument) return "on_file";
  return periodStart < today ? "missing" : "upcoming";
}

// ---------------------------------------------------------------------------
// 90-day strip
// ---------------------------------------------------------------------------

export const STRIP_DAYS = 90;

/** Left offset (0–100 %) of a date on the strip that starts today. */
export const stripPosition = (date: string, today: string) =>
  Math.max(0, Math.min(100, (daysBetween(today, date) / STRIP_DAYS) * 100));

/** Month boundaries inside the strip, with their labels ("November"). */
export function stripMonths(today: string): { label: string; left: number }[] {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const out: { label: string; left: number }[] = [];
  let first = `${addMonths(today.slice(0, 8) + "01", 1, 1)}`;
  while (daysBetween(today, first) < STRIP_DAYS) {
    out.push({ label: names[Number(first.slice(5, 7)) - 1]!, left: stripPosition(first, today) });
    first = addMonths(first, 1, 1);
  }
  return out;
}

/** The date a subscription appears on the strip: annual renewal, or contract end. */
export function stripDate(sub: {
  kind: Kind;
  cycle: Cycle;
  renewalDate: string | null;
  contractEndDate: string | null;
}): string | null {
  return sub.kind === "contract"
    ? sub.contractEndDate
    : sub.cycle === "yearly"
      ? sub.renewalDate
      : null;
}

// ---------------------------------------------------------------------------
// Strip label layout (B-08)
// ---------------------------------------------------------------------------

/** One thing drawn on a strip lane: a dot with a visible label, or a count bubble for several. */
export type StripEntry<T> = {
  /** Left offset in % of the track. */
  pos: number;
  /** 0 = label beside the dot, 1 = label on a second line under it. */
  row: 0 | 1;
  /** The label sits to the left of the dot (near the right edge). */
  flip: boolean;
  /** One item: dot + label. Several: a count bubble listing them. */
  items: T[];
};

export const STRIP_LABEL_W = 14; // % of the track a label may use (CSS truncates the text to this)
const STRIP_DOT = 1; // % either side of a dot kept clear
const STRIP_MERGE = 2.2; // marks closer than this become a bubble
const STRIP_BUBBLE = 1.8;

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * Lays out one lane of strip marks so no label overlaps a dot or another label: labels go
 * beside the dot, then on a second line, and marks that cannot be told apart (or cannot
 * fit either line) merge into a count bubble. Pure; positions are percentages.
 */
export function layoutStripLane<T extends { pos: number }>(items: T[]): StripEntry<T>[] {
  const sorted = [...items].sort((a, b) => a.pos - b.pos);
  let groups: T[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && item.pos - last[last.length - 1]!.pos < STRIP_MERGE) last.push(item);
    else groups.push([item]);
  }

  for (;;) {
    const entries = groups.map((items) => {
      const pos = items[0]!.pos;
      const flip = items.length === 1 && pos + STRIP_LABEL_W > 100 && pos - STRIP_LABEL_W >= 0;
      const dot: [number, number] =
        items.length > 1
          ? [pos - STRIP_BUBBLE, pos + STRIP_BUBBLE]
          : [pos - STRIP_DOT, pos + STRIP_DOT];
      const label: [number, number] | null =
        items.length > 1
          ? null
          : flip
            ? [pos - STRIP_LABEL_W, pos + STRIP_DOT]
            : [pos - STRIP_DOT, pos + STRIP_LABEL_W];
      return { pos, flip, items, dot, label, row: 0 as 0 | 1 };
    });
    const row1: [number, number][] = [];
    const row0: [number, number][] = [];
    let failed = -1;
    for (let i = 0; i < entries.length && failed < 0; i++) {
      const e = entries[i]!;
      if (!e.label) continue;
      const hitsDot = entries.some((o, j) => j !== i && overlaps(e.label!, o.dot));
      if (!hitsDot && !row0.some((r) => overlaps(e.label!, r))) {
        row0.push(e.label);
      } else if (!row1.some((r) => overlaps(e.label!, r))) {
        e.row = 1;
        row1.push(e.label);
      } else failed = i;
    }
    if (failed < 0) return entries.map(({ pos, row, flip, items }) => ({ pos, row, flip, items }));
    // Neither line is free: fold this mark into its neighbour as a count bubble.
    const at = failed > 0 ? failed - 1 : failed;
    groups = [
      ...groups.slice(0, at),
      [...groups[at]!, ...groups[at + 1]!],
      ...groups.slice(at + 2),
    ];
  }
}
