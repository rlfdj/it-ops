import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  documents,
  people,
  proratedSeats,
  subscriptionInvoices,
  subscriptions,
  vendors,
} from "@/db/schema";
import { conventionalDocumentName } from "@/lib/document-names";
import { paidTotals, type SeatSource, type SeatTier } from "@/lib/subscription-seats";
import type { Cycle, InvoiceStatus, Kind } from "@/lib/subscriptions";

export type SubscriptionRow = {
  id: string;
  name: string;
  vendor: string;
  kind: Kind;
  plan: string | null;
  seats: number | null;
  seatsStandard: number | null;
  seatsPremium: number | null;
  /** Sold in Standard / Premium seats (shows the seat roster). */
  tieredSeats: boolean;
  billingCycle: Cycle;
  billingDay: number | null;
  /** The expected cost per period; null when the bill varies. */
  costOriginal: number | null;
  currency: string;
  costAed: number | null;
  paidBy: string | null;
  userName: string | null;
  project: string | null;
  nextChargeDate: string | null;
  renewalDate: string | null;
  contractEndDate: string | null;
  autoRenew: boolean;
  active: boolean;
  missing: number;
  onFile: number;
  /** The latest on-file renewal invoice: its amount, period date and seat counts. */
  lastPaidAed: number | null;
  lastPaidDate: string | null;
  lastPaidStandard: number | null;
  lastPaidPremium: number | null;
};

export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  const counts = getDb()
    .select({
      subscriptionId: subscriptionInvoices.subscriptionId,
      missing:
        sql<number>`count(*) filter (where ${subscriptionInvoices.status} = 'missing')::int`.as(
          "missing",
        ),
      onFile:
        sql<number>`count(*) filter (where ${subscriptionInvoices.status} = 'on_file')::int`.as(
          "on_file",
        ),
    })
    .from(subscriptionInvoices)
    .where(isNull(subscriptionInvoices.removedAt))
    .groupBy(subscriptionInvoices.subscriptionId)
    .as("counts");

  const rows = await getDb()
    .select({
      id: subscriptions.id,
      name: subscriptions.name,
      vendor: vendors.name,
      kind: subscriptions.kind,
      plan: subscriptions.plan,
      seats: subscriptions.seats,
      seatsStandard: subscriptions.seatsStandard,
      seatsPremium: subscriptions.seatsPremium,
      tieredSeats: subscriptions.tieredSeats,
      billingCycle: subscriptions.billingCycle,
      billingDay: subscriptions.billingDay,
      costOriginal: subscriptions.costOriginal,
      currency: subscriptions.currency,
      costAed: subscriptions.costAed,
      paidBy: subscriptions.paidBy,
      userName: subscriptions.userName,
      project: subscriptions.project,
      nextChargeDate: subscriptions.nextChargeDate,
      renewalDate: subscriptions.renewalDate,
      contractEndDate: subscriptions.contractEndDate,
      autoRenew: subscriptions.autoRenew,
      active: subscriptions.active,
      missing: sql<number>`coalesce(${counts.missing}, 0)`,
      onFile: sql<number>`coalesce(${counts.onFile}, 0)`,
    })
    .from(subscriptions)
    .innerJoin(vendors, eq(vendors.id, subscriptions.vendorId))
    .leftJoin(counts, eq(counts.subscriptionId, subscriptions.id))
    .orderBy(
      desc(subscriptions.active),
      asc(subscriptions.nextChargeDate),
      asc(subscriptions.name),
    );

  // The latest on-file renewal invoice of every subscription (one row each).
  const last = await getDb()
    .selectDistinctOn([subscriptionInvoices.subscriptionId], {
      subscriptionId: subscriptionInvoices.subscriptionId,
      amountAed: subscriptionInvoices.amountAed,
      periodStart: subscriptionInvoices.periodStart,
      seatsStandard: subscriptionInvoices.seatsStandard,
      seatsPremium: subscriptionInvoices.seatsPremium,
    })
    .from(subscriptionInvoices)
    .where(
      and(
        eq(subscriptionInvoices.status, "on_file"),
        eq(subscriptionInvoices.kind, "renewal"),
        isNull(subscriptionInvoices.removedAt),
      ),
    )
    .orderBy(subscriptionInvoices.subscriptionId, desc(subscriptionInvoices.periodStart));
  const lastBySub = new Map(last.map((l) => [l.subscriptionId, l]));

  return rows.map((r) => {
    const l = lastBySub.get(r.id);
    return {
      ...r,
      missing: Number(r.missing),
      onFile: Number(r.onFile),
      lastPaidAed: l?.amountAed ?? null,
      lastPaidDate: l?.periodStart ?? null,
      lastPaidStandard: l?.seatsStandard ?? null,
      lastPaidPremium: l?.seatsPremium ?? null,
    };
  });
}

/** What the invoices on file add up to this month and this year (by period or charge date). */
export async function getPaidTotals(today: string): Promise<{ month: number; year: number }> {
  const rows = await getDb()
    .select({
      periodStart: subscriptionInvoices.periodStart,
      amountAed: subscriptionInvoices.amountAed,
    })
    .from(subscriptionInvoices)
    .where(and(eq(subscriptionInvoices.status, "on_file"), isNull(subscriptionInvoices.removedAt)));
  return paidTotals(rows, today);
}

/** Names of everyone in On/Offboarding, for the seat suggestions. */
export async function listPersonNames(): Promise<string[]> {
  const rows = await getDb()
    .select({ name: people.fullName })
    .from(people)
    .orderBy(people.fullName);
  return rows.map((r) => r.name);
}

/**
 * Every invoice of a subscription reduced to seat data (all periods, no limit), for the
 * pre-fill of the next renewal invoice.
 */
export async function listSeatSources(subscriptionId: string): Promise<SeatSource[]> {
  const rows = await getDb()
    .select({
      id: subscriptionInvoices.id,
      kind: subscriptionInvoices.kind,
      periodStart: subscriptionInvoices.periodStart,
      seatsStandard: subscriptionInvoices.seatsStandard,
      seatsPremium: subscriptionInvoices.seatsPremium,
    })
    .from(subscriptionInvoices)
    .where(
      and(
        eq(subscriptionInvoices.subscriptionId, subscriptionId),
        isNull(subscriptionInvoices.removedAt),
      ),
    );
  const prorated = rows.filter((r) => r.kind === "prorated").map((r) => r.id);
  const seats = prorated.length
    ? await getDb()
        .select({ invoiceId: proratedSeats.invoiceId, tier: proratedSeats.tier })
        .from(proratedSeats)
        .where(inArray(proratedSeats.invoiceId, prorated))
    : [];
  const byInvoice = Map.groupBy(seats, (s) => s.invoiceId);
  return rows.map(({ id, ...r }) => ({
    ...r,
    tiers: (byInvoice.get(id) ?? []).map((s) => s.tier as SeatTier),
  }));
}

export type InvoiceRow = {
  id: string;
  kind: "renewal" | "prorated";
  periodStart: string;
  periodLabel: string;
  /** Pro-rated rows: who or what the charge is for. */
  userName: string | null;
  project: string | null;
  invoiceNumber: string | null;
  /** Null for a period without an expected cost that has no invoice yet. */
  amountOriginal: number | null;
  amountAed: number | null;
  /** Renewal invoices of tiered subscriptions: the seat counts billed. */
  seatsStandard: number | null;
  seatsPremium: number | null;
  /** Pro-rated invoices: the seats it added. */
  seats: { personName: string; tier: SeatTier; project: string | null }[];
  status: InvoiceStatus;
  documentId: string | null;
  /** The file's conventional name, computed from current data (null without a file). */
  documentName: string | null;
};

/** The invoice ledger, newest period first. `subscription` supplies the current user and project. */
export async function listInvoices(
  subscription: { id: string; name: string; userName: string | null; project: string | null },
  limit = 24,
): Promise<InvoiceRow[]> {
  const rows = await getDb()
    .select({
      id: subscriptionInvoices.id,
      kind: subscriptionInvoices.kind,
      periodStart: subscriptionInvoices.periodStart,
      periodLabel: subscriptionInvoices.periodLabel,
      userName: subscriptionInvoices.userName,
      project: subscriptionInvoices.project,
      invoiceNumber: subscriptionInvoices.invoiceNumber,
      amountOriginal: subscriptionInvoices.amountOriginal,
      amountAed: subscriptionInvoices.amountAed,
      seatsStandard: subscriptionInvoices.seatsStandard,
      seatsPremium: subscriptionInvoices.seatsPremium,
      status: subscriptionInvoices.status,
      documentId: subscriptionInvoices.documentId,
      storedName: documents.fileName,
      originalName: documents.originalName,
    })
    .from(subscriptionInvoices)
    .leftJoin(documents, eq(documents.id, subscriptionInvoices.documentId))
    .where(
      and(
        eq(subscriptionInvoices.subscriptionId, subscription.id),
        isNull(subscriptionInvoices.removedAt),
      ),
    )
    .orderBy(desc(subscriptionInvoices.periodStart), asc(subscriptionInvoices.kind))
    .limit(limit);
  const proratedIds = rows.filter((r) => r.kind === "prorated").map((r) => r.id);
  const seatRows = proratedIds.length
    ? await getDb()
        .select({
          invoiceId: proratedSeats.invoiceId,
          personName: proratedSeats.personName,
          tier: proratedSeats.tier,
          project: proratedSeats.project,
        })
        .from(proratedSeats)
        .where(inArray(proratedSeats.invoiceId, proratedIds))
        .orderBy(proratedSeats.createdAt, proratedSeats.personName)
    : [];
  const seatsByInvoice = Map.groupBy(seatRows, (s) => s.invoiceId);
  return rows.map(({ storedName, originalName, ...r }) => {
    const seats = (seatsByInvoice.get(r.id) ?? []).map((s) => ({
      personName: s.personName,
      tier: s.tier as SeatTier,
      project: s.project,
    }));
    return {
      ...r,
      seats,
      documentName:
        r.documentId && storedName
          ? conventionalDocumentName({
              owner: "subscription_invoice",
              subscriptionName: subscription.name,
              invoiceNumber: r.invoiceNumber,
              userName: subscription.userName,
              project: subscription.project,
              invoice: {
                kind: r.kind,
                periodStart: r.periodStart,
                userName: r.userName,
                project: r.project,
                seats,
              },
              originalName,
              storedName,
            })
          : null,
    };
  });
}
