import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  activityLog,
  documents,
  proratedSeats,
  subscriptionInvoices,
  subscriptions,
} from "@/db/schema";
import { paidTotals } from "@/lib/subscription-seats";
import { client, inRollback, TEST_ACTOR } from "@/test/db";
import type { Tx } from "@/db/actor";
import {
  addInvoicePeriod,
  checkSubscriptionImport,
  importSubscriptions,
  createSubscription,
  ensureInvoicePeriods,
  recordInvoiceDocument,
  setAutoRenew,
  updateSubscription,
} from "./subscriptions";
import { documentDownloadName } from "./documents";

afterAll(() => client.end());

/** The seeded subscription, or (the live database holds real data) one made inside the test's transaction. */
async function sub(tx: Tx, name: string) {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.name, name));
  if (row) return row;
  const { id } = await createSubscription(tx, {
    name,
    vendorName: "TEST Seed Vendor",
    kind: "subscription",
    billingCycle: "monthly",
    costOriginal: name === "Jira Software Cloud" ? 362.25 : 160,
    currency: "USD",
    nextChargeDate: "2026-11-03",
    autoRenew: true,
  });
  const [made] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
  return made!;
}
/**
 * The renewal-only unique index of migration 0025, made inside the test's transaction when the
 * database doesn't have it yet (rolled back with the test).
 */
async function renewalOnlyIndex(tx: Tx) {
  await tx.execute(
    sql`drop index if exists subscription_invoices_subscription_id_period_start_index`,
  );
  await tx.execute(
    sql`create unique index if not exists subscription_invoices_renewal_period_unique
        on subscription_invoices (subscription_id, period_start) where kind = 'renewal'`,
  );
}
const invoices = (tx: Tx, subscriptionId: string) =>
  tx
    .select()
    .from(subscriptionInvoices)
    .where(eq(subscriptionInvoices.subscriptionId, subscriptionId))
    .orderBy(subscriptionInvoices.periodStart);

/** A past renewal row without a file (added here, so the test doesn't depend on live data). */
async function missingRow(tx: Tx, subscriptionId: string) {
  const { id } = await addInvoicePeriod(
    tx,
    { subscriptionId, periodStart: "2024-01-05", amountOriginal: 640 },
    "2026-10-14",
  );
  const [row] = await tx.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.id, id));
  return row!;
}

describe("ensureInvoicePeriods", () => {
  it("rolls a passed charge forward: past period missing, next one upcoming, date moved", async () => {
    await inRollback(async (tx) => {
      const claude = await sub(tx, "Claude Team");
      const charge = claude.nextChargeDate!;
      const dayAfter = new Date(Date.parse(`${charge}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);

      const result = await ensureInvoicePeriods(tx, dayAfter);
      expect(result.advanced).toBeGreaterThanOrEqual(1);

      const after = await sub(tx, "Claude Team");
      expect(after.nextChargeDate! > charge).toBe(true);
      const rows = await invoices(tx, claude.id);
      expect(rows.find((r) => r.periodStart === charge)?.status).toBe("missing");
      expect(rows.find((r) => r.periodStart === after.nextChargeDate)?.status).toBe("upcoming");
    });
  });

  it("is idempotent: a second run changes nothing", async () => {
    await inRollback(async (tx) => {
      await ensureInvoicePeriods(tx, "2026-12-01");
      expect(await ensureInvoicePeriods(tx, "2026-12-01")).toEqual({
        created: 0,
        flipped: 0,
        advanced: 0,
      });
    });
  });

  it("is logged as the actor running it", async () => {
    await inRollback(async (tx) => {
      const claude = await sub(tx, "Claude Team");
      await ensureInvoicePeriods(tx, "2026-12-01");
      const [log] = await tx
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.recordId, claude.id), eq(activityLog.action, "update")));
      expect(log?.actor).toBe(TEST_ACTOR);
      expect(log?.module).toBe("Subscriptions");
    });
  });
});

describe("invoices", () => {
  it("attaching a file marks the period on file and converts USD amounts", async () => {
    await inRollback(async (tx) => {
      const claude = await sub(tx, "Claude Team");
      const missing = await missingRow(tx, claude.id);
      await recordInvoiceDocument(tx, {
        invoiceId: missing.id,
        storagePath: `subscription-invoices/${missing.id}/test.pdf`,
        fileName: "test.pdf",
        sizeBytes: 100,
        invoiceNumber: "ANT-TEST-1",
        amountOriginal: 640,
      });
      const [after] = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, missing.id));
      expect(after).toMatchObject({
        status: "on_file",
        invoiceNumber: "ANT-TEST-1",
        amountOriginal: 640,
      });
      expect(after?.amountAed).toBe(2350.4); // 640 × 3.6725
      const docs = await tx.select().from(documents).where(eq(documents.ownerId, missing.id));
      expect(docs).toHaveLength(1);
      // InvoiceNumber_Name_Subscription_Invoice_YYYY-MM.pdf (the typed number leads), upload name kept.
      expect(docs[0]?.fileName).toBe(
        `ANT-TEST-1_Claude-Team_Subscription_Invoice_${(await invoices(tx, claude.id)).find((r) => r.id === missing.id)!.periodStart.slice(0, 7)}.pdf`,
      );
      expect(docs[0]?.originalName).toBe("test.pdf");
    });
  });

  it("replacing a file returns the old path", async () => {
    await inRollback(async (tx) => {
      const claude = await sub(tx, "Claude Team");
      const onFile = await missingRow(tx, claude.id);
      await recordInvoiceDocument(tx, {
        invoiceId: onFile.id,
        storagePath: `subscription-invoices/${onFile.id}/old.pdf`,
        fileName: "old.pdf",
        sizeBytes: 100,
        amountOriginal: 640,
      });
      const { replacedPaths } = await recordInvoiceDocument(tx, {
        invoiceId: onFile.id,
        storagePath: `subscription-invoices/${onFile.id}/new.pdf`,
        fileName: "new.pdf",
        sizeBytes: 100,
        amountOriginal: 640,
      });
      expect(replacedPaths).toHaveLength(1);
    });
  });

  it("adds a period by hand but refuses a duplicate", async () => {
    await inRollback(async (tx) => {
      const jira = await sub(tx, "Jira Software Cloud");
      const { id } = await addInvoicePeriod(
        tx,
        { subscriptionId: jira.id, periodStart: "2026-04-02", amountOriginal: 362.25 },
        "2026-10-13",
      );
      const [row] = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, id));
      expect(row).toMatchObject({ periodLabel: "Apr 2026", status: "missing", amountAed: 1330.36 });
      await expect(
        addInvoicePeriod(
          tx,
          { subscriptionId: jira.id, periodStart: "2026-04-15", amountOriginal: 1 },
          "2026-10-13",
        ),
      ).rejects.toThrow(/already a row for Apr 2026/);
    });
  });
});

describe("pro-rated invoices", () => {
  it("may share a month with the renewal row; a second renewal is still refused", async () => {
    await inRollback(async (tx) => {
      const jira = await sub(tx, "Jira Software Cloud");
      await addInvoicePeriod(
        tx,
        { subscriptionId: jira.id, periodStart: "2025-03-02", amountOriginal: 10 },
        "2026-10-13",
      );
      const { id } = await addInvoicePeriod(
        tx,
        {
          subscriptionId: jira.id,
          kind: "prorated",
          periodStart: "2025-03-14",
          amountOriginal: 25,
          seats: [{ personName: "Sara", tier: "premium" }],
        },
        "2026-10-13",
      );
      const [row] = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, id));
      expect(row).toMatchObject({
        kind: "prorated",
        periodLabel: "Pro-rated · 14 Mar",
        status: "missing",
      });
      await expect(
        addInvoicePeriod(
          tx,
          { subscriptionId: jira.id, periodStart: "2025-03-20", amountOriginal: 1 },
          "2026-10-13",
        ),
      ).rejects.toThrow(/already a row for Mar 2025/);
      // The database itself blocks a duplicate renewal period, but not a pro-rated one.
      await expect(
        tx.insert(subscriptionInvoices).values({
          subscriptionId: jira.id,
          periodStart: "2025-03-02",
          periodLabel: "Mar 2025",
          amountOriginal: 1,
          amountAed: 1,
        }),
      ).rejects.toThrow();
    });
  });

  it("takes several pro-rated invoices on one date, also a renewal's date", async () => {
    await inRollback(async (tx) => {
      await renewalOnlyIndex(tx);
      const jira = await sub(tx, "Jira Software Cloud");
      await addInvoicePeriod(
        tx,
        { subscriptionId: jira.id, periodStart: "2025-03-02", amountOriginal: 10 },
        "2026-10-13",
      );
      for (const person of ["Sara", "Omar", "Lina"])
        await addInvoicePeriod(
          tx,
          {
            subscriptionId: jira.id,
            kind: "prorated",
            periodStart: "2025-03-02",
            amountOriginal: 5,
            seats: [{ personName: person, tier: "standard" }],
          },
          "2026-10-13",
        );
      const rows = (await invoices(tx, jira.id)).filter((r) => r.periodStart === "2025-03-02");
      expect(rows.map((r) => r.kind).sort()).toEqual([
        "prorated",
        "prorated",
        "prorated",
        "renewal",
      ]);
      // A second renewal on that date is still refused, and generating periods stays idempotent.
      await expect(
        addInvoicePeriod(
          tx,
          { subscriptionId: jira.id, periodStart: "2025-03-02", amountOriginal: 1 },
          "2026-10-13",
        ),
      ).rejects.toThrow(/already a row for Mar 2025/);
      await ensureInvoicePeriods(tx, "2026-10-13");
      const once = (await invoices(tx, jira.id)).length;
      await ensureInvoicePeriods(tx, "2026-10-13");
      expect((await invoices(tx, jira.id)).length).toBe(once);
    });
  });

  it("needs at least one seat, each with a person", async () => {
    await inRollback(async (tx) => {
      const jira = await sub(tx, "Jira Software Cloud");
      await expect(
        addInvoicePeriod(
          tx,
          {
            subscriptionId: jira.id,
            kind: "prorated",
            periodStart: "2026-10-14",
            amountOriginal: 5,
          },
          "2026-10-14",
        ),
      ).rejects.toThrow(/at least one seat/);
      await expect(
        addInvoicePeriod(
          tx,
          {
            subscriptionId: jira.id,
            kind: "prorated",
            periodStart: "2026-10-14",
            amountOriginal: 5,
            seats: [{ personName: " ", tier: "standard" }],
          },
          "2026-10-14",
        ),
      ).rejects.toThrow(/person/);
    });
  });

  it("ensureInvoicePeriods stays idempotent with pro-rated rows present", async () => {
    await inRollback(async (tx) => {
      const jira = await sub(tx, "Jira Software Cloud");
      await addInvoicePeriod(
        tx,
        {
          subscriptionId: jira.id,
          kind: "prorated",
          periodStart: "2026-12-05",
          amountOriginal: 5,
          seats: [{ personName: "Sara", tier: "standard", project: "Atlas" }],
        },
        "2026-10-14",
      );
      await ensureInvoicePeriods(tx, "2026-12-01");
      expect(await ensureInvoicePeriods(tx, "2026-12-01")).toEqual({
        created: 0,
        flipped: 0,
        advanced: 0,
      });
    });
  });

  it("names the file from the seat's person and the charge date", async () => {
    await inRollback(async (tx) => {
      const jira = await sub(tx, "Jira Software Cloud");
      const { id } = await addInvoicePeriod(
        tx,
        {
          subscriptionId: jira.id,
          kind: "prorated",
          periodStart: "2026-10-14",
          amountOriginal: 5,
          seats: [{ personName: "Sara", tier: "standard", project: "Atlas" }],
        },
        "2026-10-14",
      );
      const { fileName } = await recordInvoiceDocument(tx, {
        invoiceId: id,
        storagePath: `subscription-invoices/${id}/p.pdf`,
        fileName: "p.pdf",
        sizeBytes: 5,
        amountOriginal: 5,
      });
      expect(fileName).toBe(
        "Jira-Software-Cloud_Subscription_Sara_Pro-rated_Invoice_2026-10-14.pdf",
      );
    });
  });
});

describe("download name", () => {
  it("follows the subscription's current user, even for an already uploaded invoice", async () => {
    await inRollback(async (tx) => {
      const claude = await sub(tx, "Claude Team");
      const row = await missingRow(tx, claude.id);
      await recordInvoiceDocument(tx, {
        invoiceId: row.id,
        storagePath: `subscription-invoices/${row.id}/n.pdf`,
        fileName: "n.pdf",
        sizeBytes: 5,
        amountOriginal: 5,
      });
      const [doc] = await tx.select().from(documents).where(eq(documents.ownerId, row.id));
      const month = row.periodStart.slice(0, 7);
      await tx
        .update(subscriptions)
        .set({ userName: null, project: null })
        .where(eq(subscriptions.id, claude.id));
      expect(await documentDownloadName(tx, doc!.id)).toBe(
        `Claude-Team_Subscription_Invoice_${month}.pdf`,
      );
      await tx
        .update(subscriptions)
        .set({ userName: "Test" })
        .where(eq(subscriptions.id, claude.id));
      expect(await documentDownloadName(tx, doc!.id)).toBe(
        `Claude-Team_Subscription_Test_Invoice_${month}.pdf`,
      );
    });
  });
});

describe("create and edit", () => {
  it("derives AED cost, billing day and renewal date", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        name: "Figma Professional",
        vendorName: "Figma",
        kind: "subscription",
        plan: "Professional",
        seats: 5,
        billingCycle: "yearly",
        costOriginal: 900,
        currency: "USD",
        nextChargeDate: "2027-03-14",
        autoRenew: true,
      });
      const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
      expect(row).toMatchObject({ costAed: 3305.25, billingDay: 14, renewalDate: "2027-03-14" });

      await updateSubscription(tx, {
        id,
        name: "Figma Professional",
        vendorName: "Figma",
        kind: "subscription",
        billingCycle: "monthly",
        costOriginal: 75,
        currency: "USD",
        nextChargeDate: "2026-11-03",
        autoRenew: true,
      });
      const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
      expect(after).toMatchObject({ billingCycle: "monthly", renewalDate: null, billingDay: 3 });

      await setAutoRenew(tx, { id, autoRenew: false });
      expect(
        (await tx.select().from(subscriptions).where(eq(subscriptions.id, id)))[0]?.autoRenew,
      ).toBe(false);
    });
  });

  it("requires an end date for contracts", async () => {
    await inRollback(async (tx) => {
      await expect(
        createSubscription(tx, {
          name: "Line",
          vendorName: "du",
          kind: "contract",
          billingCycle: "monthly",
          costOriginal: 100,
          currency: "AED",
          nextChargeDate: "2026-11-01",
          autoRenew: false,
        }),
      ).rejects.toThrow(/end date/);
    });
  });
});

describe("CSV import", () => {
  const csvRow = (name: string, extra: Record<string, string> = {}) => ({
    name,
    vendorName: "TEST Import Vendor",
    kind: "subscription",
    plan: "",
    seats: "",
    billingCycle: "monthly",
    costOriginal: "10",
    currency: "AED",
    userName: "",
    project: "",
    paidBy: "",
    nextChargeDate: "2026-12-01",
    contractEndDate: "",
    autoRenew: "yes",
    active: "yes",
    ...extra,
  });

  it("takes a row without an expected cost", async () => {
    await inRollback(async (tx) => {
      expect(await importSubscriptions(tx, [csvRow("TEST imp blank", { costOriginal: "" })])).toBe(
        1,
      );
      const [row] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.name, "TEST imp blank"));
      expect(row).toMatchObject({ costOriginal: null, costAed: null });
    });
  });

  it("reports per-row problems and imports all rows or none", async () => {
    await inRollback(async (tx) => {
      const rows = [
        csvRow("TEST imp 1"),
        csvRow("test imp 1"),
        csvRow("TEST imp 2", { nextChargeDate: "13/10/2026" }),
        csvRow("TEST imp 3", { kind: "weekly" }),
      ];
      const check = await checkSubscriptionImport(tx, rows);
      expect(check.errors.map((e) => e.row)).toEqual([2, 3, 4]);
      expect(check.errors[0]!.message).toMatch(/repeats row 1/);
      await expect(importSubscriptions(tx, rows)).rejects.toThrow(/nothing was imported/);
      const good = [csvRow("TEST imp 1"), csvRow("TEST imp 2")];
      expect(await importSubscriptions(tx, good)).toBe(2);
      const [one] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.name, "TEST imp 1"));
      expect(one).toMatchObject({ autoRenew: true });
      expect(
        (await checkSubscriptionImport(tx, [csvRow("TEST imp 1")])).errors[0]!.message,
      ).toMatch(/already recorded/);
    });
  });
});

describe("tiered seats and the expected cost", () => {
  const base = {
    vendorName: "TEST Tier Vendor",
    kind: "subscription" as const,
    billingCycle: "monthly" as const,
    costOriginal: 100,
    currency: "AED",
    nextChargeDate: "2026-11-03",
    autoRenew: true,
  };
  const read = async (tx: Tx, id: string) =>
    (await tx.select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!;
  const bill = async (tx: Tx, subscriptionId: string, periodStart: string, extra = {}) => {
    const { id } = await addInvoicePeriod(
      tx,
      { subscriptionId, periodStart, amountOriginal: 1000, ...extra },
      "2026-10-15",
    );
    return id;
  };
  const file = (tx: Tx, invoiceId: string, extra: { amountOriginal?: number } = {}) =>
    recordInvoiceDocument(tx, {
      invoiceId,
      storagePath: `subscription-invoices/${invoiceId}/f.pdf`,
      fileName: "f.pdf",
      sizeBytes: 5,
      amountOriginal: 1000,
      ...extra,
    });
  const invoice = async (tx: Tx, id: string) =>
    (await tx.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.id, id)))[0]!;

  it("lets the expected cost be blank (null), and keeps a blank bill out of the rows' amounts", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "TEST No Cost",
        costOriginal: "",
      });
      expect(await read(tx, id)).toMatchObject({ costOriginal: null, costAed: null });
      await ensureInvoicePeriods(tx, "2026-12-01");
      const rows = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.subscriptionId, id));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r).toMatchObject({ amountOriginal: null, amountAed: null });
      // Filing one needs the amount.
      const missing = rows.find((r) => r.status === "missing")!;
      await expect(file(tx, missing.id, { amountOriginal: Number.NaN })).rejects.toThrow(/amount/i);
    });
  });

  it("keeps a typed expected cost as before (the live subscriptions keep theirs)", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "TEST With Cost",
        costOriginal: 100,
      });
      expect(await read(tx, id)).toMatchObject({ costOriginal: 100, costAed: 100 });
      await updateSubscription(tx, { ...base, id, name: "TEST With Cost", costOriginal: "" });
      expect(await read(tx, id)).toMatchObject({ costOriginal: null, costAed: null });
    });
  });

  it("gives tiered subscriptions no plan or seats, and leaves the stored counts alone on edit", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "ChatGPT Business",
        tieredSeats: true,
        plan: "Team",
        seats: 9,
      });
      expect(await read(tx, id)).toMatchObject({ plan: null, seats: null });
      // The owner's existing counts (the fallback for the first pre-fill) survive an edit.
      await tx
        .update(subscriptions)
        .set({ seatsStandard: 76, seatsPremium: 2, seats: 78, plan: "Team" })
        .where(eq(subscriptions.id, id));
      await updateSubscription(tx, {
        ...base,
        id,
        name: "chatgpt business",
        tieredSeats: true,
        plan: "x",
        seats: 3,
      });
      expect(await read(tx, id)).toMatchObject({
        seatsStandard: 76,
        seatsPremium: 2,
        seats: 78,
        plan: "Team",
      });
    });
  });

  it("keeps other names on the single plan and seats fields, tiers null", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "TEST Tier Other",
        plan: "Pro",
        seats: 7,
      });
      expect(await read(tx, id)).toMatchObject({
        plan: "Pro",
        seats: 7,
        seatsStandard: null,
        seatsPremium: null,
      });
    });
  });

  it("stores Standard and Premium counts on a tiered renewal invoice, nothing on others", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "Claude Code Team",
        tieredSeats: true,
      });
      const row = await bill(tx, id, "2026-09-05", { seatsStandard: "76", seatsPremium: 2 });
      expect(await invoice(tx, row)).toMatchObject({ seatsStandard: 76, seatsPremium: 2 });
      // Uploading the file (the amount is required) keeps or changes the counts.
      await file(tx, row);
      await recordInvoiceDocument(tx, {
        invoiceId: row,
        storagePath: `subscription-invoices/${row}/g.pdf`,
        fileName: "g.pdf",
        sizeBytes: 5,
        amountOriginal: 1200,
        seatsStandard: 77,
        seatsPremium: "3",
      });
      expect(await invoice(tx, row)).toMatchObject({
        status: "on_file",
        seatsStandard: 77,
        seatsPremium: 3,
        amountOriginal: 1200,
      });

      const other = await createSubscription(tx, { ...base, name: "TEST Not Tiered" });
      const otherRow = await bill(tx, other.id, "2026-09-05", { seatsStandard: 5 });
      expect(await invoice(tx, otherRow)).toMatchObject({
        seatsStandard: null,
        seatsPremium: null,
      });
      // The database refuses a negative count (this aborts the transaction, so it goes last).
      await expect(
        tx
          .update(subscriptionInvoices)
          .set({ seatsStandard: -1 })
          .where(eq(subscriptionInvoices.id, row)),
      ).rejects.toThrow();
    });
  });

  it("stores a pro-rated invoice's seats, and deleting the invoice deletes them", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "Claude Code Team",
        tieredSeats: true,
      });
      const pr = await bill(tx, id, "2026-10-14", {
        kind: "prorated",
        seats: [
          { personName: "Sara Pro", tier: "premium", project: "Bidding" },
          { personName: "Omar", tier: "standard" },
        ],
      });
      const seats = await tx.select().from(proratedSeats).where(eq(proratedSeats.invoiceId, pr));
      expect(seats.map((x) => [x.personName, x.tier, x.project]).sort()).toEqual([
        ["Omar", "standard", null],
        ["Sara Pro", "premium", "Bidding"],
      ]);
      // Two seats with different projects: the file is named "Multiple".
      const { fileName } = await file(tx, pr);
      expect(fileName).toBe(
        "Claude-Code-Team_Subscription_Multiple_Pro-rated_Invoice_2026-10-14.pdf",
      );
      // The pro-rated row never carries renewal counts.
      expect(await invoice(tx, pr)).toMatchObject({ seatsStandard: null, kind: "prorated" });
      // The activity log records the seats under the Subscriptions module.
      const [log] = await tx
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.tableName, "prorated_seats"),
            eq(activityLog.action, "insert"),
            eq(activityLog.recordId, seats[0]!.id),
          ),
        );
      expect(log).toMatchObject({ module: "Subscriptions", actor: TEST_ACTOR });
      expect(log!.recordLabel).toMatch(/^Claude Code Team · /);
      await tx.delete(subscriptionInvoices).where(eq(subscriptionInvoices.id, pr));
      expect(
        await tx.select().from(proratedSeats).where(eq(proratedSeats.invoiceId, pr)),
      ).toHaveLength(0);
    });
  });

  it("names a one-seat pro-rated file after the person, a shared project after the project", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        ...base,
        name: "Claude Code Team",
        tieredSeats: true,
      });
      const one = await bill(tx, id, "2026-10-14", {
        kind: "prorated",
        seats: [{ personName: "Sara Pro", tier: "premium", project: "Bidding" }],
      });
      expect((await file(tx, one)).fileName).toBe(
        "Claude-Code-Team_Subscription_Sara-Pro_Pro-rated_Invoice_2026-10-14.pdf",
      );
      const shared = await bill(tx, id, "2026-10-20", {
        kind: "prorated",
        seats: [
          { personName: "A", tier: "standard", project: "Bidding" },
          { personName: "B", tier: "premium", project: "Bidding" },
        ],
      });
      const { fileName } = await file(tx, shared);
      expect(fileName).toBe(
        "Claude-Code-Team_Subscription_Bidding_Pro-rated_Invoice_2026-10-20.pdf",
      );
      const [doc] = await tx.select().from(documents).where(eq(documents.ownerId, shared));
      expect(await documentDownloadName(tx, doc!.id)).toBe(fileName);
    });
  });

  it("adds up what is on file: paid this month and this year, pro-rated included, removed excluded", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, { ...base, name: "TEST Paid" });
      const oct = await bill(tx, id, "2026-10-05");
      const octPro = await bill(tx, id, "2026-10-12", {
        kind: "prorated",
        amountOriginal: 250,
        seats: [{ personName: "Sara", tier: "standard" }],
      });
      const jan = await bill(tx, id, "2026-01-05", { amountOriginal: 400 });
      const gone = await bill(tx, id, "2026-02-05", { amountOriginal: 99 });
      await bill(tx, id, "2026-11-05", { amountOriginal: 7 }); // never filed
      for (const row of [oct, octPro, jan, gone])
        await file(tx, row, { amountOriginal: (await invoice(tx, row)).amountOriginal! });
      await tx
        .update(subscriptionInvoices)
        .set({ removedAt: new Date() })
        .where(eq(subscriptionInvoices.id, gone));
      const onFile = await tx
        .select({
          periodStart: subscriptionInvoices.periodStart,
          amountAed: subscriptionInvoices.amountAed,
        })
        .from(subscriptionInvoices)
        .where(
          and(
            eq(subscriptionInvoices.subscriptionId, id),
            eq(subscriptionInvoices.status, "on_file"),
            isNull(subscriptionInvoices.removedAt),
          ),
        );
      expect(paidTotals(onFile, "2026-10-15")).toEqual({ month: 1250, year: 1650 });
    });
  });
});
