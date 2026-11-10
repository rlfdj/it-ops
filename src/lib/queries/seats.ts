import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { seatAssignments, subscriptions } from "@/db/schema";
import { nameKey, type RosterSeat } from "@/lib/seat-roster";
import type { SeatTier } from "@/lib/subscription-seats";

/** Every seat of a subscription, active and past, by person. */
export async function listSeats(subscriptionId: string): Promise<RosterSeat[]> {
  const rows = await getDb()
    .select({
      id: seatAssignments.id,
      personName: seatAssignments.personName,
      personId: seatAssignments.personId,
      tier: seatAssignments.tier,
      project: seatAssignments.project,
      since: seatAssignments.since,
      until: seatAssignments.until,
      source: seatAssignments.source,
    })
    .from(seatAssignments)
    .where(eq(seatAssignments.subscriptionId, subscriptionId))
    .orderBy(asc(sql`lower(${seatAssignments.personName})`), desc(seatAssignments.since));
  return rows.map((r) => ({
    ...r,
    tier: r.tier as SeatTier,
    source: r.source as RosterSeat["source"],
  }));
}

export type PersonSeat = {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  tier: SeatTier;
  project: string | null;
  since: string;
};

/** The active seats a person holds (by person link, else by name). */
export async function listSeatsOfPerson(person: {
  id: string;
  name: string;
  email?: string | null;
}): Promise<PersonSeat[]> {
  const rows = await getDb()
    .select({
      id: seatAssignments.id,
      subscriptionId: subscriptions.id,
      subscriptionName: subscriptions.name,
      tier: seatAssignments.tier,
      project: seatAssignments.project,
      since: seatAssignments.since,
    })
    .from(seatAssignments)
    .innerJoin(subscriptions, eq(subscriptions.id, seatAssignments.subscriptionId))
    .where(
      and(
        isNull(seatAssignments.until),
        sql`(${seatAssignments.personId} = ${person.id} or (${seatAssignments.personId} is null and lower(btrim(${seatAssignments.personName})) in (${nameKey(person.name)}, ${nameKey(person.email ?? person.name)})))`,
      ),
    )
    .orderBy(asc(subscriptions.name));
  return rows.map((r) => ({ ...r, tier: r.tier as SeatTier }));
}
