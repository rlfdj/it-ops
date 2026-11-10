// Seat counts per invoice (tiered subscriptions), the pre-fill for the next
// renewal invoice, and the paid totals. Pure functions (no I/O). Dates are `YYYY-MM-DD`.

export type SeatTier = "standard" | "premium";
export const SEAT_TIER_LABEL: Record<SeatTier, string> = {
  standard: "Standard",
  premium: "Premium",
};

export type SeatCounts = { standard: number; premium: number };

/** One invoice, reduced to what the seat pre-fill needs. Removed periods are left out by the caller. */
export type SeatSource = {
  kind: "renewal" | "prorated";
  periodStart: string;
  /** Renewal invoices: the counts typed on the invoice, null when none were recorded. */
  seatsStandard: number | null;
  seatsPremium: number | null;
  /** Pro-rated invoices: the tier of each seat the invoice added. */
  tiers: SeatTier[];
};

/**
 * The counts to offer for a renewal invoice: the latest earlier renewal invoice that has
 * counts, plus the seats added by pro-rated invoices dated after it (and before `before`).
 * Without any counted invoice it falls back to the subscription's own counts (the owner's
 * current numbers). `before` is the new invoice's period start; omit it for "right now".
 */
export function prefillSeats(
  sources: SeatSource[],
  fallback: { standard: number | null; premium: number | null },
  before?: string,
): SeatCounts {
  const earlier = (s: SeatSource) => !before || s.periodStart < before;
  const base = sources
    .filter((s) => s.kind === "renewal" && earlier(s))
    .filter((s) => s.seatsStandard != null || s.seatsPremium != null)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  if (!base) return { standard: fallback.standard ?? 0, premium: fallback.premium ?? 0 };
  const counts = { standard: base.seatsStandard ?? 0, premium: base.seatsPremium ?? 0 };
  for (const s of sources)
    if (s.kind === "prorated" && s.periodStart > base.periodStart && earlier(s))
      for (const tier of s.tiers) counts[tier]++;
  return counts;
}

/** "Standard 76 · Premium 2" (null when both are blank). */
export function seatCountsLabel(standard: number | null, premium: number | null): string | null {
  if (standard == null && premium == null) return null;
  return `Standard ${standard ?? 0} · Premium ${premium ?? 0}`;
}

/** "+1 Premium · +2 Standard" for a pro-rated invoice (premium first, as owners list it). */
export function addedSeatsLabel(tiers: SeatTier[]): string {
  const premium = tiers.filter((t) => t === "premium").length;
  const standard = tiers.length - premium;
  return [premium ? `+${premium} Premium` : null, standard ? `+${standard} Standard` : null]
    .filter(Boolean)
    .join(" · ");
}

/** The paid sums for the stats band: this month and this year, by invoice period or charge date. */
export function paidTotals(
  invoices: { periodStart: string; amountAed: number | null }[],
  today: string,
): { month: number; year: number } {
  let month = 0;
  let year = 0;
  for (const i of invoices) {
    if (i.amountAed == null) continue;
    if (i.periodStart.slice(0, 4) === today.slice(0, 4)) year += i.amountAed;
    if (i.periodStart.slice(0, 7) === today.slice(0, 7)) month += i.amountAed;
  }
  return { month: Math.round(month * 100) / 100, year: Math.round(year * 100) / 100 };
}

/** The latest on-file renewal invoice (by period start), or null. */
export function latestRenewal<
  T extends { kind: "renewal" | "prorated"; periodStart: string; status: string },
>(invoices: T[]): T | null {
  return (
    invoices
      .filter((i) => i.kind === "renewal" && i.status === "on_file")
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0] ?? null
  );
}
