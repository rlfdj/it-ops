// Seat tiers (Standard and Premium) for subscriptions flagged `tiered_seats`.

/** Total seats for the two tiers (a blank tier counts as 0); null when both are blank. */
export function seatTotal(
  standard: number | null | undefined,
  premium: number | null | undefined,
): number | null {
  if (standard == null && premium == null) return null;
  return (standard ?? 0) + (premium ?? 0);
}

/** "Standard 4 · Premium 2 (6 seats)" for the detail panel. */
export function tierSummary(standard: number | null, premium: number | null): string | null {
  if (standard == null && premium == null) return null;
  const total = seatTotal(standard, premium)!;
  return `Standard ${standard ?? 0} · Premium ${premium ?? 0} (${total} ${total === 1 ? "seat" : "seats"})`;
}

/** Whether a subscription is sold in Standard / Premium seats: its stored `tiered_seats` flag. */
export function isTieredSubscription(sub: { tieredSeats?: boolean | null }): boolean {
  return Boolean(sub.tieredSeats);
}
