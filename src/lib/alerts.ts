import { daysBetween, formatDate } from "./dates.ts";
import { poHref, subscriptionHref, taskHref } from "./links.ts";
import { DOC_LABEL, type PoDocKind } from "./procurement.ts";

/** Renewal alerts start 30 days out and escalate at 14. */
export const RENEWAL_ALERT_DAYS = [30, 14] as const;
/** A PO is chased once a document has been missing for more than this many days. */
export const PO_MISSING_DAYS = 7;
/** Overdue tasks stay in the bell for this long, then only the dashboard carries them. */
export const OVERDUE_ALERT_DAYS = 14;

export type Alert = {
  /** Stable id of this alert: the record plus the threshold crossed. */
  key: string;
  kind: "renewal" | "task" | "po";
  tone: "red" | "amber";
  title: string;
  detail: string;
  href: string;
};

export type AlertInput = {
  today: string;
  /** Base currency code shown beside renewal costs (default AED). */
  currency?: string;
  renewals: {
    id: string;
    name: string;
    vendor: string;
    kind: string;
    due: string;
    /** The expected cost per period; null when the bill varies. */
    costAed: number | null;
  }[];
  overdueTasks: { id: string; title: string; dueDate: string }[];
  pos: {
    id: string;
    poNumber: string;
    vendor: string;
    requestedOn: string;
    missing: PoDocKind[];
  }[];
};

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const agoDays = (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`);

/**
 * The alerts that are true right now, derived from live data. Nothing is stored for them,
 * so there is nothing to keep in sync and nothing to expire. Most urgent first.
 */
export function deriveAlerts({
  today,
  currency = "AED",
  renewals,
  overdueTasks,
  pos,
}: AlertInput): Alert[] {
  const rows: (Alert & { urgency: number })[] = [];

  for (const r of renewals) {
    const days = daysBetween(today, r.due);
    if (days < 0 || days > RENEWAL_ALERT_DAYS[0]) continue;
    const threshold = days <= RENEWAL_ALERT_DAYS[1] ? RENEWAL_ALERT_DAYS[1] : RENEWAL_ALERT_DAYS[0];
    const verb = r.kind === "contract" ? "ends" : "renews";
    rows.push({
      key: `renewal:${r.id}:${r.due}:${threshold}`,
      kind: "renewal",
      tone: threshold === RENEWAL_ALERT_DAYS[1] ? "red" : "amber",
      title: `${r.name} ${verb} ${inDays(days)}`,
      detail: `${r.vendor} · ${r.costAed == null ? "no expected cost" : `${currency} ${Math.round(r.costAed).toLocaleString("en-US")}`} · ${formatDate(r.due)}`,
      href: subscriptionHref(r.id),
      urgency: days,
    });
  }

  for (const t of overdueTasks) {
    const age = daysBetween(t.dueDate, today);
    if (age < 1 || age > OVERDUE_ALERT_DAYS) continue;
    rows.push({
      key: `task:${t.id}:${t.dueDate}`,
      kind: "task",
      tone: "red",
      title: `Task overdue: ${t.title}`,
      detail: `Was due ${formatDate(t.dueDate)} (${agoDays(age)})`,
      href: taskHref(t.id),
      urgency: -age,
    });
  }

  for (const p of pos) {
    const age = daysBetween(p.requestedOn, today);
    if (!p.missing.length || age <= PO_MISSING_DAYS) continue;
    rows.push({
      key: `po:${p.id}`,
      kind: "po",
      tone: p.missing.includes("delivery_note") ? "red" : "amber",
      title: `${p.poNumber} is missing ${p.missing.map((k) => DOC_LABEL[k].toLowerCase()).join(", ")}`,
      detail: `${p.vendor} · requested ${agoDays(age)}`,
      href: poHref(p.poNumber),
      urgency: -age,
    });
  }

  const weight = (a: Alert) => (a.tone === "red" ? 0 : 1);
  return rows
    .sort((a, b) => weight(a) - weight(b) || a.urgency - b.urgency || a.key.localeCompare(b.key))
    .map((row) => ({
      key: row.key,
      kind: row.kind,
      tone: row.tone,
      title: row.title,
      detail: row.detail,
      href: row.href,
    }));
}

export type AlertWithState = Alert & { read: boolean };

/** Drops dismissed alerts and marks read ones. */
export function applyAlertStates(
  alerts: Alert[],
  states: ReadonlyMap<string, "read" | "dismissed">,
): AlertWithState[] {
  return alerts
    .filter((a) => states.get(a.key) !== "dismissed")
    .map((a) => ({ ...a, read: states.get(a.key) === "read" }));
}
