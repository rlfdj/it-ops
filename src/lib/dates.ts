// Date helpers. Business dates are calendar dates in the workspace time zone (Settings;
// Asia/Dubai by default) as `YYYY-MM-DD` strings.

export const TIME_ZONE = "Asia/Dubai";

/** The calendar date of an instant in `timeZone`, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string = TIME_ZONE, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The year of an instant in `timeZone` (used for PO numbering). */
export const yearIn = (timeZone: string = TIME_ZONE, now: Date = new Date()) =>
  Number(todayIn(timeZone, now).slice(0, 4));

/** Aliases from when the zone was fixed; they default to Dubai. */
export const todayInDubai = (now: Date = new Date(), timeZone: string = TIME_ZONE) =>
  todayIn(timeZone, now);
export const yearInDubai = (now: Date = new Date(), timeZone: string = TIME_ZONE) =>
  yearIn(timeZone, now);

/** Three-letter month names. Fixed, because ICU's en-GB uses "Sept". */
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Formats `YYYY-MM-DD` (or a Date, in `timeZone`) as `13 Oct 2026`. */
export function formatDate(value: string | Date, timeZone: string = TIME_ZONE): string {
  const iso = typeof value === "string" ? value : todayIn(timeZone, value);
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Adds days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The instant a calendar date starts in `timeZone` (its local midnight). Handles zones
 * with daylight saving by correcting the UTC guess with the zone's offset on that day.
 */
export function startOfDayIn(date: string, timeZone: string = TIME_ZONE): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return (
      Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - instant
    );
  };
  let instant = utcMidnight - offsetAt(utcMidnight);
  instant = utcMidnight - offsetAt(instant);
  return new Date(instant);
}
