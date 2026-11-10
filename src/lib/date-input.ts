import { MONTHS, formatDate } from "./dates.ts";

const FULL_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** `YYYY-MM-DD` if y/m/d is a real calendar date, else null. */
function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthFromName(name: string): number | null {
  const n = name.toLowerCase().replace(/\.$/, "");
  if (n.length < 3) return null;
  const index = FULL_MONTHS.findIndex((m) => m === n || (n.length <= 4 && m.startsWith(n)));
  return index === -1 ? null : index + 1;
}

/**
 * Parses what a person types into `YYYY-MM-DD`: "13 Oct 2026", "13 October 2026",
 * "2026-10-13", or "13/10/2026" (day first, as everywhere in this app). Returns null when
 * the text is not a real date. Empty text is not a date either (the caller decides).
 */
export function parseDateInput(text: string): string | null {
  const s = text.trim().replace(/\s+/g, " ");
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9}\.?),?[ -](\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[2]!);
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/** The text shown in the field: "13 Oct 2026", or "" when there is no value. */
export const formatDateInput = (value: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : "";

/** Year and 0-based month of a `YYYY-MM-DD`, or of today when blank. */
export function monthOf(value: string, fallback: string): { year: number; month: number } {
  const v = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  return { year: Number(v.slice(0, 4)), month: Number(v.slice(5, 7)) - 1 };
}

/**
 * The weeks of a month for a calendar grid, Monday first. Each cell is a `YYYY-MM-DD` and
 * whether it belongs to the shown month.
 */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month, 1 - lead);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: { date: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start + (w * 7 + d) * 86_400_000);
      row.push({ date: day.toISOString().slice(0, 10), inMonth: day.getUTCMonth() === month });
    }
    weeks.push(row);
  }
  return weeks;
}

export const monthLabel = (year: number, month: number) => `${MONTHS[month]} ${year}`;
