// Subscription writes. Each runs inside a caller-provided transaction (from withActor).

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { DomainError } from "../lib/domain-error.ts";
import {
  documents,
  proratedSeats,
  subscriptionInvoices,
  subscriptions,
  vendors,
} from "../db/schema.ts";
import { billingCurrency, toAed } from "../lib/config.ts";
import { isTieredSubscription } from "../lib/seat-tiers.ts";
import { addProratedSeatsToRoster } from "./seats.ts";
import {
  SUBSCRIPTION_CSV_LABEL,
  toSubscriptionInput,
  type SubscriptionCsvRow,
} from "../lib/subscription-import.ts";
import {
  invoiceStatusFor,
  periodLabel,
  planRollover,
  proratedLabel,
} from "../lib/subscriptions.ts";
import {
  fileExtension,
  invoiceNumberPrefix,
  proratedInvoiceStem,
  proratedSeatsLabel,
  subscriptionInvoiceStem,
} from "../lib/document-names.ts";
import { freeDocumentName, vendorIdFor } from "./procurement.ts";
import { getBilling } from "./settings.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-13.");
const optionalDate = isoDate
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => v || null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

const nullIfBlank = (v: unknown) => (v === "" || v === undefined ? null : v);

const wholeCount = z.preprocess(
  nullIfBlank,
  z.coerce.number("Use a whole number.").int("Use a whole number.").min(0).max(100_000).nullable(),
);
const optionalSeats = wholeCount.optional();

/** An amount that may be left blank (null). */
const optionalMoney = (what: string) =>
  z.preprocess(
    nullIfBlank,
    z.coerce
      .number(`${what} must be a number.`)
      .min(0, `${what} can’t be negative.`)
      .max(100_000_000)
      .nullable(),
  );

export const subscriptionInput = z
  .object({
    name: z.string().trim().min(1, "Give it a name.").max(200),
    vendorName: z.string().trim().min(1, "Choose or enter a vendor.").max(120),
    kind: z.enum(["subscription", "contract"]),
    plan: optionalText(200),
    seats: optionalSeats,
    billingCycle: z.enum(["monthly", "yearly"]),
    /** Expected cost per period: for fixed contracts; blank when the bill varies. */
    costOriginal: optionalMoney("Cost"),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
    paidBy: optionalText(200),
    userName: optionalText(200),
    project: optionalText(200),
    nextChargeDate: isoDate,
    contractEndDate: optionalDate,
    autoRenew: z.boolean(),
    active: z.boolean().default(true),
    /** Sold in Standard and Premium seats (counts live on the invoices). */
    tieredSeats: z.boolean().default(false),
  })
  .refine((d) => d.kind !== "contract" || d.contractEndDate, {
    message: "Contracts need an end date.",
    path: ["contractEndDate"],
  })
  // Tiered subscriptions have no plan or seats on the subscription (their Standard and
  // Premium counts live on the invoices): those columns are left as they are. Others keep
  // the single seats number and never the tier columns.
  .transform((d) =>
    d.tieredSeats
      ? { ...d, plan: undefined, seats: undefined }
      : { ...d, seatsStandard: null, seatsPremium: null },
  );

export const subscriptionUpdateInput = z.object({ id: z.uuid() }).and(subscriptionInput);

/** Columns derived from the form: base-currency cost, billing day, renewal date. */
function derived(
  data: z.output<typeof subscriptionInput>,
  { usdRate, baseCurrency }: { usdRate: number; baseCurrency: string },
) {
  if (data.currency !== "USD" && data.currency !== baseCurrency) {
    throw new DomainError(`Bill in ${baseCurrency} or USD.`);
  }
  return {
    costAed:
      data.costOriginal == null
        ? null
        : toAed(data.costOriginal, data.currency, usdRate, baseCurrency),
    billingDay: Number(data.nextChargeDate.slice(8, 10)),
    renewalDate: data.billingCycle === "yearly" ? data.nextChargeDate : null,
  };
}

export async function createSubscription(
  tx: Tx,
  input: z.input<typeof subscriptionInput>,
): Promise<{ id: string }> {
  const data = subscriptionInput.parse(input);
  const { vendorName, ...rest } = data;
  const [row] = await tx
    .insert(subscriptions)
    .values({
      ...rest,
      ...derived(data, await getBilling(tx)),
      vendorId: await vendorIdFor(tx, vendorName),
    })
    .returning({ id: subscriptions.id });
  return { id: row!.id };
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export type SubscriptionImportCheck = { ok: boolean; errors: { row: number; message: string }[] };
const MAX_IMPORT = 300;

/** Checks every row: fields, name + vendor repeated in the file or already recorded. Writes nothing. */
export async function checkSubscriptionImport(
  tx: Tx,
  rows: SubscriptionCsvRow[],
): Promise<SubscriptionImportCheck> {
  if (rows.length === 0) return { ok: false, errors: [{ row: 0, message: "No rows to import." }] };
  if (rows.length > MAX_IMPORT)
    return {
      ok: false,
      errors: [{ row: 0, message: `Import up to ${MAX_IMPORT} rows at a time.` }],
    };
  const errors: SubscriptionImportCheck["errors"] = [];
  const { baseCurrency } = await getBilling(tx);
  const existing = new Set(
    (
      await tx
        .select({ name: subscriptions.name, vendor: vendors.name })
        .from(subscriptions)
        .innerJoin(vendors, eq(vendors.id, subscriptions.vendorId))
    ).map((r) => `${r.name.toLowerCase()}|${r.vendor.toLowerCase()}`),
  );
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const row = i + 1;
    for (const key of ["name", "vendorName", "nextChargeDate"] as const) {
      if (!raw[key].trim()) {
        errors.push({ row, message: `${SUBSCRIPTION_CSV_LABEL[key]} is empty.` });
        return;
      }
    }
    const parsed = subscriptionInput.safeParse(toSubscriptionInput(raw, baseCurrency));
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const key = issue.path[0] as keyof SubscriptionCsvRow | undefined;
      const label = key ? SUBSCRIPTION_CSV_LABEL[key] : null;
      errors.push({ row, message: label ? `${label}: ${issue.message}` : issue.message });
      return;
    }
    const key = `${parsed.data.name.toLowerCase()}|${parsed.data.vendorName.toLowerCase()}`;
    if (seen.has(key))
      errors.push({
        row,
        message: `${parsed.data.name} (${parsed.data.vendorName}) repeats row ${seen.get(key)}.`,
      });
    else if (existing.has(key))
      errors.push({
        row,
        message: `${parsed.data.name} (${parsed.data.vendorName}) is already recorded.`,
      });
    else seen.set(key, row);
  });
  return { ok: errors.length === 0, errors };
}

/** Creates every row in one transaction, or none (any bad row fails the whole import). */
export async function importSubscriptions(tx: Tx, rows: SubscriptionCsvRow[]): Promise<number> {
  const check = await checkSubscriptionImport(tx, rows);
  if (!check.ok) {
    const first = check.errors[0]!;
    throw new DomainError(
      `${check.errors.length} problem${check.errors.length === 1 ? "" : "s"} found; nothing was imported. ${first.row ? `Row ${first.row}: ` : ""}${first.message}`,
    );
  }
  const { baseCurrency } = await getBilling(tx);
  for (const row of rows)
    await createSubscription(
      tx,
      toSubscriptionInput(row, baseCurrency) as Parameters<typeof createSubscription>[1],
    );
  return rows.length;
}

export async function updateSubscription(tx: Tx, input: z.input<typeof subscriptionUpdateInput>) {
  const data = subscriptionUpdateInput.parse(input);
  const { id, vendorName, ...rest } = data;
  const updated = await tx
    .update(subscriptions)
    .set({
      ...rest,
      ...derived(data, await getBilling(tx)),
      vendorId: await vendorIdFor(tx, vendorName),
    })
    .where(eq(subscriptions.id, id))
    .returning({ id: subscriptions.id });
  if (!updated.length) throw new DomainError("Subscription not found.");
}

export async function setAutoRenew(tx: Tx, input: { id: string; autoRenew: boolean }) {
  const { id, autoRenew } = z.object({ id: z.uuid(), autoRenew: z.boolean() }).parse(input);
  const updated = await tx
    .update(subscriptions)
    .set({ autoRenew })
    .where(eq(subscriptions.id, id))
    .returning({ id: subscriptions.id });
  if (!updated.length) throw new DomainError("Subscription not found.");
}

// ---------------------------------------------------------------------------
// ensureInvoicePeriods (business rule 4)
// ---------------------------------------------------------------------------

export type RolloverResult = { created: number; flipped: number; advanced: number };

/**
 * Idempotent. For every active subscription: records a row for each billing period that
 * has passed, keeps an `upcoming` row for the next one, and moves `next_charge_date`
 * forward. Then flips any past, undocumented `upcoming` rows to `missing`.
 * Run as the system actor (on dashboard and subscriptions load; later a cron).
 */
export async function ensureInvoicePeriods(tx: Tx, today: string): Promise<RolloverResult> {
  const subs = await tx
    .select({
      id: subscriptions.id,
      cycle: subscriptions.billingCycle,
      billingDay: subscriptions.billingDay,
      nextChargeDate: subscriptions.nextChargeDate,
      contractEndDate: subscriptions.contractEndDate,
      autoRenew: subscriptions.autoRenew,
      costOriginal: subscriptions.costOriginal,
      costAed: subscriptions.costAed,
    })
    .from(subscriptions)
    .where(eq(subscriptions.active, true))
    .orderBy(subscriptions.id);

  // One insert for every period of every subscription (it used to be one per subscription,
  // which kept the transaction, and its row locks, open for seconds on each page load).
  const rows: (typeof subscriptionInvoices.$inferInsert)[] = [];
  let advanced = 0;
  for (const sub of subs) {
    if (!sub.nextChargeDate) continue;
    const plan = planRollover(
      {
        cycle: sub.cycle,
        billingDay: sub.billingDay,
        nextChargeDate: sub.nextChargeDate,
        contractEndDate: sub.contractEndDate,
        autoRenew: sub.autoRenew,
      },
      today,
    );
    const periods = [...plan.passed, ...(plan.upcoming ? [plan.upcoming] : [])];
    for (const periodStart of periods) {
      rows.push({
        subscriptionId: sub.id,
        periodStart,
        periodLabel: periodLabel(sub.cycle, periodStart),
        amountOriginal: sub.costOriginal,
        amountAed: sub.costAed,
        status: invoiceStatusFor(periodStart, false, today),
      });
    }
    if (plan.nextChargeDate !== sub.nextChargeDate) {
      await tx
        .update(subscriptions)
        .set({
          nextChargeDate: plan.nextChargeDate,
          ...(sub.cycle === "yearly" ? { renewalDate: plan.nextChargeDate } : {}),
        })
        .where(eq(subscriptions.id, sub.id));
      advanced++;
    }
  }

  // Sorted so two page loads running this at once take the row locks in the same order.
  rows.sort((x, y) =>
    `${x.subscriptionId}${x.periodStart}`.localeCompare(`${y.subscriptionId}${y.periodStart}`),
  );
  const created = rows.length
    ? (
        await tx
          .insert(subscriptionInvoices)
          .values(rows)
          .onConflictDoNothing({
            target: [subscriptionInvoices.subscriptionId, subscriptionInvoices.periodStart],
            // Matches the renewal-only unique index (and the older full index it replaces).
            where: sql`kind = 'renewal'`,
          })
          .returning({ id: subscriptionInvoices.id })
      ).length
    : 0;

  const flipped = await tx
    .update(subscriptionInvoices)
    .set({ status: "missing" })
    .where(
      and(
        eq(subscriptionInvoices.status, "upcoming"),
        isNull(subscriptionInvoices.documentId),
        isNull(subscriptionInvoices.removedAt),
        lt(subscriptionInvoices.periodStart, today),
      ),
    )
    .returning({ id: subscriptionInvoices.id });

  return { created, flipped: flipped.length, advanced };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoiceDocumentInput = z.object({
  invoiceId: z.uuid(),
  storagePath: z.string().min(1).max(500),
  /** The uploaded file's own name; the stored name is built from the subscription and period. */
  fileName: z.string().min(1).max(200),
  mimeType: z.string().max(100).optional().nullable(),
  sizeBytes: z.number().int().min(1),
  invoiceNumber: optionalText(100),
  /** Required: the invoice's amount in the subscription's billing currency. */
  amountOriginal: z.coerce.number("Enter the amount.").min(0).max(100_000_000),
  /** Renewal invoices of the tiered subscriptions only. */
  seatsStandard: wholeCount.optional(),
  seatsPremium: wholeCount.optional(),
});

/**
 * Attaches an invoice file to a period, replacing any earlier file, and marks the
 * period on file. Returns storage paths of replaced files for the caller to delete.
 */
export async function recordInvoiceDocument(
  tx: Tx,
  input: z.input<typeof invoiceDocumentInput>,
): Promise<{ replacedPaths: string[]; fileName: string }> {
  const data = invoiceDocumentInput.parse(input);
  const billing = await getBilling(tx);
  const [invoice] = await tx
    .select({
      id: subscriptionInvoices.id,
      documentId: subscriptionInvoices.documentId,
      currency: subscriptions.currency,
      periodStart: subscriptionInvoices.periodStart,
      invoiceKind: subscriptionInvoices.kind,
      rowInvoiceNumber: subscriptionInvoices.invoiceNumber,
      rowUser: subscriptionInvoices.userName,
      rowProject: subscriptionInvoices.project,
      subscriptionName: subscriptions.name,
      tieredSeats: subscriptions.tieredSeats,
      userName: subscriptions.userName,
      project: subscriptions.project,
    })
    .from(subscriptionInvoices)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionInvoices.subscriptionId))
    .where(eq(subscriptionInvoices.id, data.invoiceId))
    .for("update", { of: subscriptionInvoices });
  if (!invoice) throw new DomainError("Invoice period not found.");

  const previous = await tx
    .delete(documents)
    .where(
      and(eq(documents.ownerType, "subscription_invoice"), eq(documents.ownerId, data.invoiceId)),
    )
    .returning({ storagePath: documents.storagePath });

  // [InvoiceNumber_]Name_Subscription_[User or Project]_Invoice_YYYY-MM.ext (the billing
  // period), or …_Pro-rated_Invoice_YYYY-MM-DD.ext (the seat's person, the shared project
  // or "Multiple"); -2, -3 … if that name is taken.
  const prorated = invoice.invoiceKind === "prorated";
  const seats = prorated
    ? await tx
        .select({ personName: proratedSeats.personName, project: proratedSeats.project })
        .from(proratedSeats)
        .where(eq(proratedSeats.invoiceId, data.invoiceId))
        .orderBy(proratedSeats.createdAt, proratedSeats.personName)
    : [];
  const seatsLabel = proratedSeatsLabel(seats);
  const fileName = await freeDocumentName(
    tx,
    invoiceNumberPrefix(data.invoiceNumber ?? invoice.rowInvoiceNumber) +
      (prorated
        ? proratedInvoiceStem(
            invoice.subscriptionName,
            invoice.periodStart,
            seatsLabel ?? invoice.rowUser,
            seatsLabel ? null : invoice.rowProject,
          )
        : subscriptionInvoiceStem(
            invoice.subscriptionName,
            invoice.periodStart,
            invoice.userName,
            invoice.project,
          )),
    fileExtension(data.fileName, data.mimeType ?? undefined),
  );
  const [doc] = await tx
    .insert(documents)
    .values({
      ownerType: "subscription_invoice",
      ownerId: data.invoiceId,
      kind: "invoice",
      storagePath: data.storagePath,
      fileName,
      originalName: data.fileName,
      sizeBytes: data.sizeBytes,
    })
    .returning({ id: documents.id });

  const counts =
    !prorated && isTieredSubscription({ tieredSeats: invoice.tieredSeats })
      ? { seatsStandard: data.seatsStandard ?? null, seatsPremium: data.seatsPremium ?? null }
      : {};
  await tx
    .update(subscriptionInvoices)
    .set({
      documentId: doc!.id,
      status: "on_file",
      ...(data.invoiceNumber ? { invoiceNumber: data.invoiceNumber } : {}),
      amountOriginal: data.amountOriginal,
      amountAed: toAed(
        data.amountOriginal,
        billingCurrency(invoice.currency, billing.baseCurrency),
        billing.usdRate,
        billing.baseCurrency,
      ),
      ...counts,
    })
    .where(eq(subscriptionInvoices.id, data.invoiceId));
  return { replacedPaths: previous.map((p) => p.storagePath), fileName };
}

const proratedSeatInput = z.object({
  personName: z.string().trim().min(1, "Enter the person for every seat.").max(200),
  tier: z.enum(["standard", "premium"]),
  project: optionalText(200),
});

export const addInvoiceInput = z
  .object({
    subscriptionId: z.uuid(),
    kind: z.enum(["renewal", "prorated"]).default("renewal"),
    periodStart: isoDate,
    invoiceNumber: optionalText(100),
    amountOriginal: z.coerce.number("Enter the amount.").min(0).max(100_000_000),
    /** Renewal invoices of the tiered subscriptions only. */
    seatsStandard: wholeCount.optional(),
    seatsPremium: wholeCount.optional(),
    /** Pro-rated only: one entry per seat (at least one). */
    seats: z.array(proratedSeatInput).max(200).optional(),
  })
  .refine((d) => d.kind !== "prorated" || (d.seats?.length ?? 0) > 0, {
    message: "Add at least one seat.",
    path: ["seats"],
  });

/**
 * "Add invoice": creates a ledger row. A renewal is for a billing period that isn't listed
 * yet (one per period); a pro-rated row is an extra charge for one or more seats and may
 * share a month with the renewal row.
 */
export async function addInvoicePeriod(
  tx: Tx,
  input: z.input<typeof addInvoiceInput>,
  today: string,
): Promise<{ id: string }> {
  const data = addInvoiceInput.parse(input);
  const billing = await getBilling(tx);
  const [sub] = await tx
    .select({
      cycle: subscriptions.billingCycle,
      currency: subscriptions.currency,
      name: subscriptions.name,
      tieredSeats: subscriptions.tieredSeats,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, data.subscriptionId));
  if (!sub) throw new DomainError("Subscription not found.");
  const prorated = data.kind === "prorated";
  const tiered = isTieredSubscription(sub);
  const counts =
    !prorated && tiered
      ? { seatsStandard: data.seatsStandard ?? null, seatsPremium: data.seatsPremium ?? null }
      : {};
  const label = prorated
    ? proratedLabel(data.periodStart)
    : periodLabel(sub.cycle, data.periodStart);
  let revive: string | null = null;
  // Pro-rated rows are extra charges: any number may fall on the same date, also a renewal's.
  if (!prorated) {
    // A renewal period the owner removed leaves a hidden marker row (see removeInvoicePeriod);
    // adding an invoice for that month reuses it instead of failing.
    const [clash] = await tx
      .select({ id: subscriptionInvoices.id, removedAt: subscriptionInvoices.removedAt })
      .from(subscriptionInvoices)
      .where(
        and(
          eq(subscriptionInvoices.subscriptionId, data.subscriptionId),
          eq(subscriptionInvoices.kind, "renewal"),
          sql`${subscriptionInvoices.periodLabel} = ${label}`,
        ),
      );
    if (clash && !clash.removedAt)
      throw new DomainError(`There is already a row for ${label}. Upload to that row instead.`);
    revive = clash?.id ?? null;
  }
  const amountAed = toAed(
    data.amountOriginal,
    billingCurrency(sub.currency, billing.baseCurrency),
    billing.usdRate,
    billing.baseCurrency,
  );
  if (revive) {
    await tx
      .update(subscriptionInvoices)
      .set({
        removedAt: null,
        periodStart: data.periodStart,
        invoiceNumber: data.invoiceNumber,
        amountOriginal: data.amountOriginal,
        amountAed,
        documentId: null,
        status: invoiceStatusFor(data.periodStart, false, today),
        ...counts,
      })
      .where(eq(subscriptionInvoices.id, revive));
    return { id: revive };
  }
  const [row] = await tx
    .insert(subscriptionInvoices)
    .values({
      subscriptionId: data.subscriptionId,
      kind: data.kind,
      periodStart: data.periodStart,
      periodLabel: label,
      invoiceNumber: data.invoiceNumber,
      amountOriginal: data.amountOriginal,
      amountAed,
      status: invoiceStatusFor(data.periodStart, false, today),
      ...counts,
    })
    .returning({ id: subscriptionInvoices.id });
  if (prorated) {
    await tx.insert(proratedSeats).values(
      data.seats!.map((seat) => ({
        invoiceId: row!.id,
        personName: seat.personName,
        tier: seat.tier,
        project: seat.project,
      })),
    );
    // The seats join the roster from the charge date (a tier or project change keeps its history).
    if (tiered)
      await addProratedSeatsToRoster(tx, {
        subscriptionId: data.subscriptionId,
        invoiceId: row!.id,
        chargeDate: data.periodStart,
        seats: data.seats!,
      });
  }
  return { id: row!.id };
}
