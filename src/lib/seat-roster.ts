// The seat roster of a tiered subscription : who holds
// which seat. Pure functions (no I/O). Dates are `YYYY-MM-DD`.

import { SEAT_TIER_LABEL, type SeatCounts, type SeatTier } from "./subscription-seats.ts";

export type RosterSeat = {
  id: string;
  personName: string;
  personId: string | null;
  tier: SeatTier;
  project: string | null;
  since: string;
  /** Null while the seat is active. */
  until: string | null;
  source: "manual" | "prorated" | "import";
};

export const nameKey = (name: string) => name.trim().toLowerCase();

export const isActiveSeat = (s: Pick<RosterSeat, "until">) => s.until === null;

/** Standard / Premium seats held on `date` (default: the seats that are active now). */
export function rosterCounts(
  seats: Pick<RosterSeat, "tier" | "since" | "until">[],
  date?: string,
): SeatCounts {
  const counts = { standard: 0, premium: 0 };
  for (const s of seats) {
    const held = date ? s.since <= date && (s.until === null || s.until > date) : s.until === null;
    if (held) counts[s.tier]++;
  }
  return counts;
}

/**
 * The invoice counts to offer: the roster's counts on the invoice date when the roster holds
 * seats then, otherwise the rule the roster-less subscriptions use (`fallback`).
 */
export function seatsForInvoice(
  seats: Pick<RosterSeat, "tier" | "since" | "until">[],
  date: string,
  fallback: () => SeatCounts,
): SeatCounts {
  const fromRoster = rosterCounts(seats, date);
  return fromRoster.standard + fromRoster.premium > 0 ? fromRoster : fallback();
}

/**
 * A non-blocking note when the counts typed on an invoice differ from the roster, e.g.
 * "Roster has 77 Standard; invoice says 76." Null when they agree or the roster is empty then.
 */
export function rosterMismatchNote(
  seats: Pick<RosterSeat, "tier" | "since" | "until">[],
  date: string,
  typed: { standard: number; premium: number },
): string | null {
  const roster = rosterCounts(seats, date);
  if (roster.standard + roster.premium === 0) return null;
  const tiers = (["standard", "premium"] as const).filter((t) => roster[t] !== typed[t]);
  if (tiers.length === 0) return null;
  if (tiers.length === 1) {
    const t = tiers[0]!;
    return `Roster has ${roster[t]} ${SEAT_TIER_LABEL[t]}; invoice says ${typed[t]}.`;
  }
  return `Roster has ${roster.standard} Standard and ${roster.premium} Premium; invoice says ${typed.standard} and ${typed.premium}.`;
}

/** "Remove Claude Code Team seat (Premium)": the offboarding checklist item for a seat. */
export const seatItemLabel = (subscriptionName: string, tier: SeatTier) =>
  `Remove ${subscriptionName} seat (${SEAT_TIER_LABEL[tier]})`;

/** "Claude Code Team · Premium · Bidding" for a person's panel. */
export const seatSummary = (s: {
  subscriptionName: string;
  tier: SeatTier;
  project: string | null;
}) => [s.subscriptionName, SEAT_TIER_LABEL[s.tier], s.project].filter(Boolean).join(" · ");

/** Case-insensitive substring match on the name or project. */
export function filterSeats<T extends Pick<RosterSeat, "personName" | "project">>(
  seats: T[],
  text: string,
): T[] {
  const q = text.trim().toLowerCase();
  if (!q) return seats;
  return seats.filter((s) => `${s.personName} ${s.project ?? ""}`.toLowerCase().includes(q));
}
