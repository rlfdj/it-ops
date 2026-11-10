/** Default conversion rate for USD charges (changeable in Settings). */
export const USD_AED = 3.6725;

export const APP_NAME = "IT Ops";

/**
 * Converts an amount in `currency` to the workspace base currency (the `aed` columns),
 * rounded to cents. `usdRate` is the workspace's "USD to base" rate (Settings); it only
 * affects amounts entered from now on.
 */
export function toAed(
  amount: number,
  currency: string,
  usdRate: number = USD_AED,
  baseCurrency: string = "AED",
): number {
  if (currency === baseCurrency) return amount;
  if (currency === "USD") return Math.round(amount * usdRate * 100) / 100;
  throw new Error(`No conversion rate configured for ${currency}`);
}
export const toBase = toAed;

/**
 * The currency to convert from for a saved row: its own when it is the base currency or
 * USD, otherwise the base (a row saved under an earlier base currency; its amounts are
 * not converted when the base changes).
 */
export const billingCurrency = (currency: string, baseCurrency: string) =>
  currency === "USD" || currency === baseCurrency ? currency : baseCurrency;
