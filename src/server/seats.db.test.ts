import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  checklistItems,
  people,
  seatAssignments,
  subscriptionInvoices,
  subscriptions,
  tasks,
} from "@/db/schema";
import { client, inRollback } from "@/test/db";
import type { Tx } from "@/db/actor";
import {
  addSeat,
  checkSeatImport,
  importSeats,
  removeSeat,
  restoreSeat,
  updateSeat,
} from "./seats";
import { addInvoicePeriod, createSubscription } from "./subscriptions";
import { createChecklist, setItemDone } from "./checklists";

afterAll(() => client.end());

/** A tiered subscription made inside the test's transaction (the live database holds real data). */
async function tiered(tx: Tx) {
  const { id } = await createSubscription(tx, {
    name: "Claude Code Team",
    tieredSeats: true,
    vendorName: "TEST Seat Vendor",
    kind: "subscription",
    billingCycle: "monthly",
    costOriginal: null,
    currency: "USD",
    nextChargeDate: "2026-11-03",
    autoRenew: true,
  });
  return id;
}
const seatsOf = (tx: Tx, subscriptionId: string) =>
  tx.select().from(seatAssignments).where(eq(seatAssignments.subscriptionId, subscriptionId));

describe("seat roster", () => {
  it("flags a tiered subscription as tiered when it is saved", async () => {
    await inRollback(async (tx) => {
      const id = await tiered(tx);
      const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
      expect(row!.tieredSeats).toBe(true);
    });
  });

  it("adds, changes and removes a seat and keeps the history", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      const { id } = await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Sara",
        tier: "standard",
        project: "Bidding",
        since: "2026-10-01",
      });
      await updateSeat(tx, { id, tier: "premium", project: "Ops" });
      let [seat] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, id));
      expect(seat).toMatchObject({
        tier: "premium",
        project: "Ops",
        until: null,
        source: "manual",
      });

      await removeSeat(tx, { id, until: "2026-10-14" });
      [seat] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, id));
      expect(seat!.until).toBe("2026-10-14");
      await expect(removeSeat(tx, { id, until: "2026-10-15" })).rejects.toThrow(/isn’t active/);
      await expect(updateSeat(tx, { id, tier: "standard", project: null })).rejects.toThrow();

      // The ended seat is still listed, and the person can be given a new one.
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "test sara",
        tier: "standard",
        since: "2026-10-15",
      });
      expect(await seatsOf(tx, sub)).toHaveLength(2);

      // The activity log records each step.
      const log = await tx.select().from(activityLog).where(eq(activityLog.recordId, id));
      expect(log.map((l) => l.action)).toEqual(["insert", "update", "update"]);
      expect(log[0]!.module).toBe("Subscriptions");
      expect(log[0]!.recordLabel).toBe("Claude Code Team · TEST Sara");
    });
  });

  it("allows one active seat per person (any case) on a subscription", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Omar",
        tier: "standard",
        since: "2026-10-01",
      });
      await expect(
        addSeat(tx, {
          subscriptionId: sub,
          personName: "test omar",
          tier: "premium",
          since: "2026-10-02",
        }),
      ).rejects.toThrow(/already holds an active seat/);
    });
  });

  it("keeps a seat roster on any subscription, not only tiered ones", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        name: "TEST Plain Tool",
        vendorName: "TEST Seat Vendor",
        kind: "subscription",
        billingCycle: "monthly",
        costOriginal: null,
        currency: "USD",
        nextChargeDate: "2026-11-03",
        autoRenew: true,
      });
      await expect(
        addSeat(tx, {
          subscriptionId: id,
          personName: "TEST X",
          tier: "standard",
          since: "2026-10-01",
        }),
      ).resolves.toHaveProperty("id");
    });
  });

  it("links a seat to the person whose name or email matches", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      const [p] = await tx
        .insert(people)
        .values({ fullName: "TEST Lina Rao", email: "test.lina@example.test" })
        .returning({ id: people.id });
      const byName = await addSeat(tx, {
        subscriptionId: sub,
        personName: "test lina rao",
        tier: "standard",
        since: "2026-10-01",
      });
      await removeSeat(tx, { id: byName.id, until: "2026-10-02" });
      const byEmail = await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST.Lina@example.test",
        tier: "standard",
        since: "2026-10-03",
      });
      const rows = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.subscriptionId, sub));
      expect(rows.find((r) => r.id === byName.id)!.personId).toBe(p!.id);
      expect(rows.find((r) => r.id === byEmail.id)!.personId).toBe(p!.id);
    });
  });

  it("imports Claude's export in one go, skipping unassigned and inactive rows", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "held@example.test",
        tier: "standard",
        since: "2026-10-01",
      });
      const rows = [
        { name: "a@example.test", seat: "Premium", project: "", status: "Active" },
        { name: "b@example.test", seat: "Standard", project: "", status: "Active" },
        { name: "c@example.test", seat: "Unassigned", project: "", status: "Active" },
        { name: "d@example.test", seat: "Standard", project: "", status: "Pending" },
      ];
      const check = await checkSeatImport(tx, sub, rows);
      expect(check).toMatchObject({
        ok: true,
        standard: 1,
        premium: 1,
        unassigned: 1,
        inactive: 1,
      });

      // One bad row fails the whole import.
      await expect(
        importSeats(tx, {
          subscriptionId: sub,
          since: "2026-10-14",
          rows: [...rows, { name: "HELD@example.test", seat: "Standard", project: "" }],
        }),
      ).rejects.toThrow(/nothing was imported/);
      expect(await seatsOf(tx, sub)).toHaveLength(1);

      expect(await importSeats(tx, { subscriptionId: sub, since: "2026-10-14", rows })).toBe(2);
      const all = await seatsOf(tx, sub);
      expect(all).toHaveLength(3);
      expect(all.filter((s) => s.source === "import").every((s) => s.since === "2026-10-14")).toBe(
        true,
      );
    });
  });

  it("adds the seats of a pro-rated invoice and records a tier change", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Sara",
        tier: "standard",
        since: "2026-09-01",
      });
      const { id: invoiceId } = await addInvoicePeriod(
        tx,
        {
          subscriptionId: sub,
          kind: "prorated",
          periodStart: "2026-10-10",
          amountOriginal: 30,
          seats: [
            { personName: "test sara", tier: "premium", project: "Ops" },
            { personName: "TEST Omar", tier: "standard", project: null },
          ],
        },
        "2026-10-14",
      );
      const all = await seatsOf(tx, sub);
      const sara = all.filter((s) => s.personName.toLowerCase() === "test sara");
      expect(sara).toHaveLength(2);
      const ended = sara.find((s) => s.until)!;
      const current = sara.find((s) => !s.until)!;
      expect(ended).toMatchObject({ tier: "standard", until: "2026-10-10", source: "manual" });
      expect(current).toMatchObject({
        tier: "premium",
        project: "Ops",
        since: "2026-10-10",
        source: "prorated",
        sourceInvoiceId: invoiceId,
      });
      const omar = all.find((s) => s.personName === "TEST Omar")!;
      expect(omar).toMatchObject({ since: "2026-10-10", until: null, source: "prorated" });

      // Removing the invoice leaves the roster alone (the link is just cleared).
      await tx.delete(subscriptionInvoices).where(eq(subscriptionInvoices.id, invoiceId));
      expect((await seatsOf(tx, sub)).filter((s) => !s.until)).toHaveLength(2);
    });
  });

  it("does not touch a roster for a subscription that isn't tiered", async () => {
    await inRollback(async (tx) => {
      const { id } = await createSubscription(tx, {
        name: "TEST Plain Tool",
        vendorName: "TEST Seat Vendor",
        kind: "subscription",
        billingCycle: "monthly",
        costOriginal: null,
        currency: "USD",
        nextChargeDate: "2026-11-03",
        autoRenew: true,
      });
      await addInvoicePeriod(
        tx,
        {
          subscriptionId: id,
          kind: "prorated",
          periodStart: "2026-10-10",
          amountOriginal: 30,
          seats: [{ personName: "TEST Sara", tier: "standard", project: null }],
        },
        "2026-10-14",
      );
      expect(await seatsOf(tx, id)).toHaveLength(0);
    });
  });
});

describe("offboarding and the roster", () => {
  const offboard = (tx: Tx, fullName: string) =>
    createChecklist(tx, {
      kind: "offboarding",
      targetDate: "2026-10-20",
      person: { fullName },
      items: [{ section: "accounts", label: "Revoke VPN access" }],
    });

  it("adds an item per active seat; ticking ends the seat, unticking restores it", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      const { id: seatId } = await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Karim Off",
        tier: "premium",
        project: "Bidding",
        since: "2026-09-01",
      });
      const { checklistId } = await offboard(tx, "test karim off");
      const items = await tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistId));
      const item = items.find((i) => i.seatAssignmentId === seatId)!;
      expect(item).toMatchObject({
        label: "Remove Claude Code Team seat (Premium)",
        section: "accounts",
        dueDate: "2026-10-20",
      });
      // It is a task like the other items.
      const [task] = await tx.select().from(tasks).where(eq(tasks.checklistItemId, item.id));
      expect(task!.title).toContain("Remove Claude Code Team seat (Premium)");

      await setItemDone(tx, { itemId: item.id, done: true });
      const [ended] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, seatId));
      expect(ended!.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await setItemDone(tx, { itemId: item.id, done: false });
      const [back] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, seatId));
      expect(back!.until).toBeNull();
    });
  });

  it("does not restore a seat when the person has a newer active one", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      const { id: seatId } = await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Nadia Off",
        tier: "standard",
        since: "2026-09-01",
      });
      const { checklistId } = await offboard(tx, "TEST Nadia Off");
      const [item] = await tx
        .select()
        .from(checklistItems)
        .where(
          and(
            eq(checklistItems.checklistId, checklistId),
            eq(checklistItems.seatAssignmentId, seatId),
          ),
        );
      await setItemDone(tx, { itemId: item!.id, done: true });
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Nadia Off",
        tier: "premium",
        since: "2026-10-14",
      });
      await setItemDone(tx, { itemId: item!.id, done: false });
      const [old] = await tx.select().from(seatAssignments).where(eq(seatAssignments.id, seatId));
      expect(old!.until).not.toBeNull();
      expect(await restoreSeat(tx, seatId)).toBe(false);
    });
  });

  it("adds no seat items for someone without seats, or for onboarding", async () => {
    await inRollback(async (tx) => {
      const sub = await tiered(tx);
      await addSeat(tx, {
        subscriptionId: sub,
        personName: "TEST Held",
        tier: "standard",
        since: "2026-09-01",
      });
      const { checklistId } = await offboard(tx, "TEST Nobody Off");
      const items = await tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistId));
      expect(items.filter((i) => i.seatAssignmentId)).toHaveLength(0);
      const onboarding = await createChecklist(tx, {
        kind: "onboarding",
        targetDate: "2026-10-20",
        person: { fullName: "TEST Held" },
        items: [{ section: "accounts", label: "Create Jira account" }],
      });
      const rows = await tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, onboarding.checklistId));
      expect(rows.filter((i) => i.seatAssignmentId)).toHaveLength(0);
    });
  });
});
