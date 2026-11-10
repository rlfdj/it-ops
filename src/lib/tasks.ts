// Task rules: quick-add parsing, overdue, grouping by due date. Pure functions.
// Dates are `YYYY-MM-DD` calendar dates in the workspace time zone.

import { addDays, daysBetween, MONTHS } from "./dates.ts";

export type Priority = 1 | 2 | 3;
export type TaskStatus = "open" | "in_progress" | "waiting" | "done";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const STATUS_TONE: Record<TaskStatus, "grey" | "blue" | "amber" | "green"> = {
  open: "grey",
  in_progress: "blue",
  waiting: "amber",
  done: "green",
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * Parses a due-date word: `today`, `tomorrow`/`tmr`, a weekday (`fri` = the next Friday
 * after today), `16oct` / `16-oct` / `oct16`, or `2026-10-16`. Returns null if unknown.
 */
export function parseDueWord(word: string, today: string): string | null {
  const w = word.toLowerCase().replace(/[.,]$/, "");
  if (w === "today" || w === "tod") return today;
  if (w === "tomorrow" || w === "tmr" || w === "tom") return addDays(today, 1);
  const wd = WEEKDAYS.findIndex((d) => w === d || w === WEEKDAY_FULL[d]);
  if (wd !== -1) {
    const diff = (wd - weekday(today) + 7) % 7 || 7;
    return addDays(today, diff);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const m = /^(\d{1,2})-?([a-z]{3})[a-z]*$/.exec(w) ?? /^([a-z]{3})[a-z]*-?(\d{1,2})$/.exec(w);
  if (m) {
    const [day, mon] = /^\d/.test(m[1]!) ? [Number(m[1]), m[2]!] : [Number(m[2]), m[1]!];
    const month = MONTHS.findIndex((x) => x.toLowerCase() === mon);
    if (month === -1 || day < 1 || day > 31) return null;
    let year = Number(today.slice(0, 4));
    const candidate = (y: number) =>
      `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // A date that has already passed this year means next year.
    if (candidate(year) < today) year++;
    return candidate(year);
  }
  return null;
}

const WEEKDAY_FULL: Record<string, string> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
};

export type QuickAdd = {
  title: string;
  dueDate: string | null;
  priority: Priority;
  /** The text after `#`, e.g. `PO-2026-0158` or `Karim-Saleh`. */
  ref: string | null;
};

/** Parses "Chase invoice @fri #PO-2026-0153 !1" into its parts. */
export function parseQuickAdd(text: string, today: string): QuickAdd {
  let dueDate: string | null = null;
  let priority: Priority = 2;
  let ref: string | null = null;
  const words: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("@") && token.length > 1) {
      const due = parseDueWord(token.slice(1), today);
      if (due) {
        dueDate = due;
        continue;
      }
    }
    if (/^![123]$/.test(token)) {
      priority = Number(token.slice(1)) as Priority;
      continue;
    }
    if (token.startsWith("#") && token.length > 1) {
      ref = token.slice(1);
      continue;
    }
    words.push(token);
  }
  return { title: words.join(" "), dueDate, priority, ref };
}

/**
 * The Source column text. "Offboarding · Karim Saleh" shortens to "Offboarding" when the
 * Related column already names that person; the full label stays in the data for CSV and search.
 */
export function sourceShortLabel(sourceLabel: string, relatedPerson: string | null): string {
  const [kind, person] = sourceLabel.split(" · ");
  return person && relatedPerson && person === relatedPerson ? kind! : sourceLabel;
}

/** Business rule 6: overdue when the due date is before today (workspace time zone) and not done. */
export const isOverdue = (dueDate: string | null, status: TaskStatus, today: string) =>
  Boolean(dueDate && dueDate < today && status !== "done");

export type DueGroup = "overdue" | "week" | "later" | "none";

export const DUE_GROUP_LABEL: Record<DueGroup, string> = {
  overdue: "Overdue",
  week: "This week",
  later: "Later",
  none: "No date",
};

export const DUE_GROUP_TONE: Record<DueGroup, "red" | "amber" | "grey"> = {
  overdue: "red",
  week: "amber",
  later: "grey",
  none: "grey",
};

/** End of the current Mon–Sun week. */
export const endOfWeek = (today: string) => addDays(today, (7 - weekday(today)) % 7);

export function dueGroup(dueDate: string | null, today: string): DueGroup {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate <= endOfWeek(today)) return "week";
  return "later";
}

/** "Wed 14 Oct" inside this week, "20 Oct" otherwise, "8 Jan 2025" in another year. */
export function formatDue(dueDate: string, today: string): string {
  const [y, m, d] = dueDate.split("-");
  const base = `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  if (y !== today.slice(0, 4)) return `${base} ${y}`;
  const days = daysBetween(today, dueDate);
  if (days >= 0 && days <= 6) return `${WEEKDAY_NAMES[weekday(dueDate)]} ${base}`;
  return base;
}
