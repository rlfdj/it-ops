/**
 * An error whose message is written for the person using the app ("Tag DP-LT-0001 is
 * already in stock."). Server actions pass these through as-is; every other error is
 * logged and shown as a generic message instead of leaking driver or storage text (B-14).
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
