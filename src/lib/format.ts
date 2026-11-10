import { MONTHS } from "./dates";

// Display formatting. Amounts are in the workspace base currency with two decimals (the
// currency code is rendered separately); dates are calendar dates in the workspace zone.

const aed = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aedWhole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** `109115` → `109,115.00` (the currency code is rendered separately). */
export const formatMoney = (amount: number) => aed.format(amount);
export const formatAed = formatMoney;

/** `6600` → `6,600`; keeps cents only when present. */
export const formatMoneyCompact = (amount: number) =>
  Number.isInteger(amount) ? aedWhole.format(amount) : aed.format(amount);
export const formatAedCompact = formatMoneyCompact;

/** `("EUR", 1500)` → `EUR 1,500.00`. */
export const moneyText = (currency: string, amount: number) => `${currency} ${formatMoney(amount)}`;

/**
 * `2026-10-11` → `11 Oct` when it falls in `today`'s year, otherwise `11 Oct 2025`
 * (tables in the designs drop the current year).
 */
export function formatShortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-");
  const base = `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  return y === today.slice(0, 4) ? base : `${base} ${y}`;
}

/** Calendar quarter containing a `YYYY-MM-DD` date. */
export function quarterOf(date: string): {
  year: number;
  quarter: number;
  start: string;
  end: string;
} {
  const year = Number(date.slice(0, 4));
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const mm = (n: number) => String(n).padStart(2, "0");
  return {
    year,
    quarter,
    start: `${year}-${mm(startMonth)}-01`,
    end: `${year}-${mm(endMonth)}-${mm(lastDay)}`,
  };
}

/** `214000` → `209 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
