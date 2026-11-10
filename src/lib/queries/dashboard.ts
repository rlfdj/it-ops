import "server-only";
import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  checklistItems,
  checklists,
  people,
  stockItems,
  subscriptionInvoices,
  subscriptions,
  vendors,
} from "@/db/schema";
import { renewalDue } from "@/lib/dashboard";
import { decisionTone, type Kind, type Tone } from "@/lib/subscriptions";
import { listPurchaseOrders } from "./procurement";

export type Renewal = {
  id: string;
  name: string;
  vendor: string;
  kind: Kind;
  cycle: "monthly" | "yearly";
  autoRenew: boolean;
  due: string;
  tone: Tone;
  /** The expected cost per period; null when the bill varies. */
  costAed: number | null;
};

export type MissingInvoice = {
  subscriptionId: string;
  name: string;
  periods: string[];
  /** Start of the oldest missing period. */
  since: string;
  /** The sum of the missing periods' amounts; null when none has an amount. */
  amountAed: number | null;
};

export type UncollectedEquipment = {
  checklistId: string;
  personName: string;
  lastDay: string;
  items: string[];
};

export async function getDashboardData(today: string) {
  const db = getDb();
  const [stock, pos, subs, invoices, offboardings] = await Promise.all([
    db
      .select({ n: count(), models: sql<number>`count(distinct ${stockItems.model})::int` })
      .from(stockItems)
      .where(eq(stockItems.status, "in_stock"))
      .then((r) => r[0] ?? { n: 0, models: 0 }),
    listPurchaseOrders(),
    db
      .select({
        id: subscriptions.id,
        name: subscriptions.name,
        kind: subscriptions.kind,
        billingCycle: subscriptions.billingCycle,
        nextChargeDate: subscriptions.nextChargeDate,
        renewalDate: subscriptions.renewalDate,
        contractEndDate: subscriptions.contractEndDate,
        autoRenew: subscriptions.autoRenew,
        costAed: subscriptions.costAed,
        vendor: vendors.name,
      })
      .from(subscriptions)
      .innerJoin(vendors, eq(vendors.id, subscriptions.vendorId))
      .where(eq(subscriptions.active, true)),
    db
      .select({
        subscriptionId: subscriptionInvoices.subscriptionId,
        name: subscriptions.name,
        periodLabel: subscriptionInvoices.periodLabel,
        periodStart: subscriptionInvoices.periodStart,
        amountAed: subscriptionInvoices.amountAed,
      })
      .from(subscriptionInvoices)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionInvoices.subscriptionId))
      .where(
        and(eq(subscriptionInvoices.status, "missing"), isNull(subscriptionInvoices.removedAt)),
      )
      .orderBy(asc(subscriptions.name), asc(subscriptionInvoices.periodStart)),
    db
      .select({
        checklistId: checklists.id,
        personName: people.fullName,
        lastDay: checklists.targetDate,
      })
      .from(checklists)
      .innerJoin(people, eq(people.id, checklists.personId))
      .where(
        and(
          eq(checklists.kind, "offboarding"),
          eq(checklists.status, "open"),
          lt(checklists.targetDate, today),
        ),
      )
      .orderBy(asc(checklists.targetDate)),
  ]);

  const renewals: Renewal[] = subs.flatMap((s) => {
    const due = renewalDue(s);
    return due
      ? [
          {
            id: s.id,
            name: s.name,
            vendor: s.vendor,
            kind: s.kind,
            cycle: s.billingCycle,
            autoRenew: s.autoRenew,
            due,
            tone: decisionTone(s, today),
            costAed: s.costAed,
          },
        ]
      : [];
  });

  const missingInvoices: MissingInvoice[] = [...Map.groupBy(invoices, (i) => i.subscriptionId)].map(
    ([subscriptionId, rows]) => ({
      subscriptionId,
      name: rows[0]!.name,
      periods: rows.map((r) => r.periodLabel),
      since: rows.map((r) => r.periodStart).sort()[0]!,
      amountAed: rows.some((r) => r.amountAed != null)
        ? rows.reduce((sum, r) => sum + (r.amountAed ?? 0), 0)
        : null,
    }),
  );

  // Equipment still listed under "Collect equipment" after the person's last day.
  let uncollected: UncollectedEquipment[] = [];
  if (offboardings.length) {
    const items = await db
      .select({
        checklistId: checklistItems.checklistId,
        id: checklistItems.id,
        parentId: checklistItems.parentId,
        label: checklistItems.label,
        doneAt: checklistItems.doneAt,
        notApplicable: checklistItems.notApplicable,
      })
      .from(checklistItems)
      .where(
        and(
          inArray(
            checklistItems.checklistId,
            offboardings.map((o) => o.checklistId),
          ),
          eq(checklistItems.section, "assets"),
          isNull(checklistItems.doneAt),
          eq(checklistItems.notApplicable, false),
        ),
      )
      .orderBy(asc(checklistItems.sort));
    const byChecklist = Map.groupBy(items, (i) => i.checklistId);
    uncollected = offboardings.flatMap((o) => {
      const open = byChecklist.get(o.checklistId) ?? [];
      if (!open.length) return [];
      const children = open.filter((i) => i.parentId);
      return [{ ...o, items: (children.length ? children : open).map((i) => i.label) }];
    });
  }

  const openPos = pos.filter((p) => p.status !== "closed");
  const awaitingApproval = pos.filter((p) => p.status === "requested");

  return {
    stock: { count: Number(stock.n), models: Number(stock.models) },
    openPos: { count: openPos.length, totalAed: sum(openPos) },
    awaitingApproval: { count: awaitingApproval.length, totalAed: sum(awaitingApproval) },
    posMissingDocs: pos.filter((p) => p.missing.length),
    renewals,
    missingInvoices,
    uncollected,
  };
}

const sum = (rows: { totalAed: number }[]) => rows.reduce((s, r) => s + r.totalAed, 0);
