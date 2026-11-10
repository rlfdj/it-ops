import { daysBetween } from "./dates.ts";
import type { Cycle, Kind } from "./subscriptions.ts";
import { dueGroup } from "./tasks.ts";

export const RENEWAL_WINDOWS = [30, 60, 90] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

/**
 * The date a subscription next costs money: contract end for contracts, the annual renewal
 * for yearly plans (falling back to the next charge), the next charge for monthly plans.
 */
export function renewalDue(sub: {
  kind: Kind;
  billingCycle: Cycle;
  nextChargeDate: string | null;
  renewalDate: string | null;
  contractEndDate: string | null;
}): string | null {
  if (sub.kind === "contract") return sub.contractEndDate;
  if (sub.billingCycle === "yearly") return sub.renewalDate ?? sub.nextChargeDate;
  return sub.nextChargeDate;
}

/**
 * The expected total of the renewals that have an expected cost; null when none has one
 * (so a list of blanks never shows as a total of 0).
 */
export function expectedTotal(items: { costAed: number | null }[]): number | null {
  const known = items.filter((i) => i.costAed != null);
  return known.length ? known.reduce((sum, i) => sum + i.costAed!, 0) : null;
}

/** Items due from today up to `days` ahead, soonest first. */
export function inWindow<T extends { due: string }>(items: T[], today: string, days: number): T[] {
  return items
    .filter((i) => {
      const d = daysBetween(today, i.due);
      return d >= 0 && d <= days;
    })
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** Due from today to the end of this calendar month. */
export const dueThisMonth = (due: string, today: string) =>
  due >= today && due.slice(0, 7) === today.slice(0, 7);

export type DashGroup = "overdue" | "week" | "later";

/** Dashboard task groups: undated tasks sit under Later. */
export function dashGroup(dueDate: string | null, today: string): DashGroup {
  const g = dueGroup(dueDate, today);
  return g === "none" ? "later" : g;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many "Needs attention" rows the dashboard shows before "n more". */
export const ATTENTION_CAP = 8;

export type Attention = { severity: "red" | "amber"; ageDays: number };

/** Red before amber, then the oldest first. Stable for equal items. */
export function rankAttention<T extends Attention>(items: T[]): T[] {
  const weight = (i: T) => (i.severity === "red" ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        weight(a.item) - weight(b.item) || b.item.ageDays - a.item.ageDays || a.index - b.index,
    )
    .map((x) => x.item);
}

/** "today", "yesterday", "18 days ago" (never negative). */
export function agoLabel(days: number): string {
  const d = Math.max(0, days);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
