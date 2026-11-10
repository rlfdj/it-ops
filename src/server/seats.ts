// Seat roster writes (ChatGPT Business / Claude Code Team). Each runs inside a caller-provided
// transaction (from withActor), so the activity log records them. An ended seat stays as
// history (`until` set); a person holds at most one active seat per subscription.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { people, seatAssignments, subscriptions } from "../db/schema.ts";
import { DomainError } from "../lib/domain-error.ts";
import { checkSeatRows, type SeatCsvRow } from "../lib/seat-import.ts";
import { nameKey } from "../lib/seat-roster.ts";
import type { SeatTier } from "../lib/subscription-seats.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-13.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);
const tierSchema = z.enum(["standard", "premium"]);

type Source = "manual" | "prorated" | "import";

/** The person a name or email belongs to (case-insensitive, exactly one match), or null. */
export async function personIdFor(tx: Tx, name: string): Promise<string | null> {
  const rows = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      sql`(lower(btrim(${people.fullName})) = ${nameKey(name)} or lower(btrim(${people.email})) = ${nameKey(name)})`,
    )
    .limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

/** The subscription the seats belong to. Any subscription can keep a seat roster. */
async function seatSubscription(tx: Tx, subscriptionId: string) {
  const [sub] = await tx
    .select({ id: subscriptions.id, name: subscriptions.name })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId));
  if (!sub) throw new DomainError("Subscription not found.");
  return sub;
}

async function activeSeatOf(tx: Tx, subscriptionId: string, personName: string) {
  const [row] = await tx
    .select()
    .from(seatAssignments)
    .where(
      and(
        eq(seatAssignments.subscriptionId, subscriptionId),
        isNull(seatAssignments.until),
        sql`lower(btrim(${seatAssignments.personName})) = ${nameKey(personName)}`,
      ),
    );
  return row ?? null;
}

export const addSeatInput = z.object({
  subscriptionId: z.uuid(),
  personName: z.string().trim().min(1, "Enter the person.").max(200),
  tier: tierSchema,
  project: optionalText(200),
  since: isoDate,
});

/** Gives a person a seat from `since`. They can hold only one active seat at a time. */
export async function addSeat(
  tx: Tx,
  input: z.input<typeof addSeatInput>,
  source: Source = "manual",
  sourceInvoiceId: string | null = null,
): Promise<{ id: string }> {
  const data = addSeatInput.parse(input);
  await seatSubscription(tx, data.subscriptionId);
  if (await activeSeatOf(tx, data.subscriptionId, data.personName))
    throw new DomainError(`${data.personName} already holds an active seat.`);
  const [row] = await tx
    .insert(seatAssignments)
    .values({
      subscriptionId: data.subscriptionId,
      personName: data.personName,
      personId: await personIdFor(tx, data.personName),
      tier: data.tier,
      project: data.project,
      since: data.since,
      source,
      sourceInvoiceId,
    })
    .returning({ id: seatAssignments.id });
  return { id: row!.id };
}

export const updateSeatInput = z.object({
  id: z.uuid(),
  tier: tierSchema,
  project: optionalText(200),
});

/** Changes an active seat's tier and project (the same row; use Remove + Add to keep a history). */
export async function updateSeat(tx: Tx, input: z.input<typeof updateSeatInput>) {
  const data = updateSeatInput.parse(input);
  const updated = await tx
    .update(seatAssignments)
    .set({ tier: data.tier, project: data.project })
    .where(and(eq(seatAssignments.id, data.id), isNull(seatAssignments.until)))
    .returning({ id: seatAssignments.id });
  if (!updated.length) throw new DomainError("That seat isn’t active any more.");
}

export const removeSeatInput = z.object({ id: z.uuid(), until: isoDate });

/** Ends a seat on `until` (never before it began). The row stays as history. */
export async function removeSeat(tx: Tx, input: z.input<typeof removeSeatInput>) {
  const data = removeSeatInput.parse(input);
  const ended = await endSeat(tx, data.id, data.until);
  if (!ended) throw new DomainError("That seat isn’t active any more.");
}

/** Sets `until` on an active seat; false when it was already ended (or doesn't exist). */
export async function endSeat(tx: Tx, seatId: string, until: string): Promise<boolean> {
  const [seat] = await tx
    .select({ since: seatAssignments.since })
    .from(seatAssignments)
    .where(and(eq(seatAssignments.id, seatId), isNull(seatAssignments.until)));
  if (!seat) return false;
  await tx
    .update(seatAssignments)
    .set({ until: until < seat.since ? seat.since : until })
    .where(eq(seatAssignments.id, seatId));
  return true;
}

/**
 * Undoes endSeat (unticking an offboarding item): the seat is active again unless the person
 * has since been given a newer active seat on the same subscription. True when restored.
 */
export async function restoreSeat(tx: Tx, seatId: string): Promise<boolean> {
  const [seat] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, seatId));
  if (!seat || seat.until === null) return false;
  if (await activeSeatOf(tx, seat.subscriptionId, seat.personName)) return false;
  await tx.update(seatAssignments).set({ until: null }).where(eq(seatAssignments.id, seatId));
  return true;
}

// ---------------------------------------------------------------------------
// Pro-rated invoices
// ---------------------------------------------------------------------------

/**
 * The seats of a saved pro-rated invoice join the roster from its charge date. A person who
 * already holds an active seat has it ended on that date and the new one starts, so a tier
 * or project change keeps its history.
 */
export async function addProratedSeatsToRoster(
  tx: Tx,
  input: {
    subscriptionId: string;
    invoiceId: string;
    chargeDate: string;
    seats: { personName: string; tier: SeatTier; project: string | null }[];
  },
): Promise<void> {
  for (const line of input.seats) {
    const current = await activeSeatOf(tx, input.subscriptionId, line.personName);
    if (current) await endSeat(tx, current.id, input.chargeDate);
    await addSeat(
      tx,
      {
        subscriptionId: input.subscriptionId,
        personName: line.personName,
        tier: line.tier,
        project: line.project,
        since: input.chargeDate,
      },
      "prorated",
      input.invoiceId,
    );
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type SeatImportCheck = {
  ok: boolean;
  problems: { row: number; message: string }[];
  /** What the valid rows would add. */
  standard: number;
  premium: number;
  /** Rows skipped for being Unassigned or not Active. */
  unassigned: number;
  inactive: number;
};

/** Checks every row (see checkSeatRows) against the active roster. Writes nothing. */
export async function checkSeatImport(
  tx: Tx,
  subscriptionId: string,
  rows: SeatCsvRow[],
): Promise<SeatImportCheck> {
  await seatSubscription(tx, subscriptionId);
  const active = await tx
    .select({ name: seatAssignments.personName })
    .from(seatAssignments)
    .where(and(eq(seatAssignments.subscriptionId, subscriptionId), isNull(seatAssignments.until)));
  const checked = checkSeatRows(
    rows,
    active.map((a) => a.name),
  );
  return {
    ok: checked.problems.length === 0,
    problems: checked.problems,
    standard: checked.rows.filter((r) => r.tier === "standard").length,
    premium: checked.rows.filter((r) => r.tier === "premium").length,
    unassigned: checked.unassigned,
    inactive: checked.inactive,
  };
}

/** Adds every row in one transaction, or none (any problem fails the whole import). */
export async function importSeats(
  tx: Tx,
  input: { subscriptionId: string; rows: SeatCsvRow[]; since: string },
): Promise<number> {
  const since = isoDate.parse(input.since);
  await seatSubscription(tx, input.subscriptionId);
  const active = await tx
    .select({ name: seatAssignments.personName })
    .from(seatAssignments)
    .where(
      and(eq(seatAssignments.subscriptionId, input.subscriptionId), isNull(seatAssignments.until)),
    );
  const { rows, problems } = checkSeatRows(
    input.rows,
    active.map((a) => a.name),
  );
  if (problems.length) {
    const first = problems[0]!;
    throw new DomainError(
      `${problems.length} problem${problems.length === 1 ? "" : "s"} found; nothing was imported. ${first.row ? `Row ${first.row}: ` : ""}${first.message}`,
    );
  }
  // Link names to people (a name that matches exactly one person, any case).
  const everyone = await tx
    .select({ id: people.id, name: people.fullName, email: people.email })
    .from(people);
  const byName = Map.groupBy(
    everyone.flatMap((p) => [
      { key: nameKey(p.name), id: p.id },
      ...(p.email ? [{ key: nameKey(p.email), id: p.id }] : []),
    ]),
    (p) => p.key,
  );
  await tx.insert(seatAssignments).values(
    rows.map((r) => {
      const matches = byName.get(nameKey(r.name)) ?? [];
      return {
        subscriptionId: input.subscriptionId,
        personName: r.name,
        personId: matches.length === 1 ? matches[0]!.id : null,
        tier: r.tier,
        project: r.project,
        since,
        source: "import" as const,
      };
    }),
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------

/** The active seats a person holds (by person link, else by name), with their subscription's name. */
export async function activeSeatsOfPerson(
  tx: Tx,
  person: { id: string; name: string; email?: string | null },
) {
  return tx
    .select({
      id: seatAssignments.id,
      subscriptionName: subscriptions.name,
      tier: seatAssignments.tier,
      project: seatAssignments.project,
    })
    .from(seatAssignments)
    .innerJoin(subscriptions, eq(subscriptions.id, seatAssignments.subscriptionId))
    .where(
      and(
        isNull(seatAssignments.until),
        sql`(${seatAssignments.personId} = ${person.id} or (${seatAssignments.personId} is null and lower(btrim(${seatAssignments.personName})) in (${nameKey(person.name)}, ${nameKey(person.email ?? person.name)})))`,
      ),
    )
    .orderBy(asc(subscriptions.name), asc(seatAssignments.createdAt));
}
