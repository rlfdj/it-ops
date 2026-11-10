import "server-only";
import { and, count, desc, eq, gte, ilike, inArray, lt, min, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activityLog,
  checklistItems,
  checklists,
  documents,
  people,
  purchaseOrders,
  seatAssignments,
  subscriptionInvoices,
  subscriptions,
} from "@/db/schema";
import { addDays, startOfDayIn } from "@/lib/dates";
import { getTimeZone } from "@/lib/queries/settings";
import type { Changes, LogContext, LogEntry } from "@/lib/activity";

export type ActivityFilters = {
  module: string | null;
  /** Inclusive calendar dates in the workspace time zone. */
  from: string | null;
  to: string | null;
  /** Record search: label text, or an exact record id. */
  q: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function where(f: ActivityFilters, timeZone: string): SQL | undefined {
  const dayStart = (date: string) => startOfDayIn(date, timeZone);
  const parts: SQL[] = [];
  if (f.module) parts.push(eq(activityLog.module, f.module));
  if (f.from) parts.push(gte(activityLog.at, dayStart(f.from)));
  if (f.to) parts.push(lt(activityLog.at, dayStart(addDays(f.to, 1))));
  if (f.q) {
    const q = f.q.trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    parts.push(UUID.test(q) ? eq(activityLog.recordId, q) : ilike(activityLog.recordLabel, like));
  }
  return parts.length ? and(...parts) : undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const changed = (c: Changes, key: string) => str(c[key]?.new) ?? str(c[key]?.old);

/** Looks up what each entry needs to link to its record (see LogContext). */
async function withContext(rows: Omit<LogEntry, "context">[]): Promise<LogEntry[]> {
  const db = getDb();
  const idsOf = (table: string) => rows.filter((r) => r.tableName === table).map((r) => r.recordId);

  // Documents → their owner (PO or subscription invoice), from the change data or the row.
  const docRows = idsOf("documents");
  const docOwners = new Map<string, { type: string | null; id: string | null }>();
  for (const r of rows.filter((r) => r.tableName === "documents")) {
    docOwners.set(r.recordId, {
      type: changed(r.changes, "owner_type"),
      id: changed(r.changes, "owner_id"),
    });
  }
  if (docRows.length) {
    const live = await db
      .select({ id: documents.id, type: documents.ownerType, ownerId: documents.ownerId })
      .from(documents)
      .where(inArray(documents.id, docRows));
    for (const d of live) docOwners.set(d.id, { type: d.type, id: d.ownerId });
  }

  // Invoice rows (direct, or as document owners) → subscription.
  const invoiceIds = [
    ...idsOf("subscription_invoices"),
    ...[...docOwners.values()]
      .filter((o) => o.type === "subscription_invoice" && o.id)
      .map((o) => o.id!),
  ];
  const invoiceSub = new Map<string, { id: string; name: string }>();
  if (invoiceIds.length) {
    const live = await db
      .select({ id: subscriptionInvoices.id, subId: subscriptions.id, name: subscriptions.name })
      .from(subscriptionInvoices)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionInvoices.subscriptionId))
      .where(inArray(subscriptionInvoices.id, invoiceIds));
    for (const i of live) invoiceSub.set(i.id, { id: i.subId, name: i.name });
  }

  // Seat roster rows → their subscription.
  const seatSub = new Map<string, { id: string; name: string }>();
  const seatIds = idsOf("seat_assignments");
  if (seatIds.length) {
    const live = await db
      .select({ id: seatAssignments.id, subId: subscriptions.id, name: subscriptions.name })
      .from(seatAssignments)
      .innerJoin(subscriptions, eq(subscriptions.id, seatAssignments.subscriptionId))
      .where(inArray(seatAssignments.id, seatIds));
    for (const s of live) seatSub.set(s.id, { id: s.subId, name: s.name });
  }

  // PO owners of documents → PO number.
  const poIds = [...docOwners.values()]
    .filter((o) => o.type === "purchase_order" && o.id)
    .map((o) => o.id!);
  const poNumber = new Map<string, string>();
  if (poIds.length) {
    const live = await db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, poIds));
    for (const p of live) poNumber.set(p.id, p.poNumber);
  }

  // Checklist items → checklist → person.
  const itemChecklist = new Map<string, string>();
  for (const r of rows.filter((r) => r.tableName === "checklist_items")) {
    const cid = changed(r.changes, "checklist_id");
    if (cid) itemChecklist.set(r.recordId, cid);
  }
  const itemIds = idsOf("checklist_items").filter((id) => !itemChecklist.has(id));
  if (itemIds.length) {
    const live = await db
      .select({ id: checklistItems.id, checklistId: checklistItems.checklistId })
      .from(checklistItems)
      .where(inArray(checklistItems.id, itemIds));
    for (const i of live) itemChecklist.set(i.id, i.checklistId);
  }
  const checklistIds = [...new Set([...idsOf("checklists"), ...itemChecklist.values()])];
  const checklistInfo = new Map<string, { name: string; kind: string }>();
  if (checklistIds.length) {
    const live = await db
      .select({ id: checklists.id, name: people.fullName, kind: checklists.kind })
      .from(checklists)
      .innerJoin(people, eq(people.id, checklists.personId))
      .where(inArray(checklists.id, checklistIds));
    for (const c of live) checklistInfo.set(c.id, { name: c.name, kind: c.kind });
  }

  return rows.map((r) => {
    let context: LogContext = {};
    switch (r.tableName) {
      case "documents": {
        const owner = docOwners.get(r.recordId);
        if (owner?.type === "purchase_order" && owner.id)
          context = { poNumber: poNumber.get(owner.id) ?? null };
        if (owner?.type === "subscription_invoice" && owner.id) {
          const sub = invoiceSub.get(owner.id);
          context = { subscriptionId: sub?.id ?? null, subscriptionName: sub?.name ?? null };
        }
        break;
      }
      case "subscription_invoices": {
        const sub = invoiceSub.get(r.recordId);
        context = {
          subscriptionId: sub?.id ?? changed(r.changes, "subscription_id"),
          subscriptionName: sub?.name ?? (r.recordLabel ?? "").split(" · ")[0] ?? null,
        };
        break;
      }
      case "seat_assignments": {
        const sub = seatSub.get(r.recordId);
        context = {
          subscriptionId: sub?.id ?? changed(r.changes, "subscription_id"),
          subscriptionName: sub?.name ?? (r.recordLabel ?? "").split(" · ")[0] ?? null,
        };
        break;
      }
      case "checklists":
      case "checklist_items": {
        const cid = r.tableName === "checklists" ? r.recordId : itemChecklist.get(r.recordId);
        const info = cid ? checklistInfo.get(cid) : undefined;
        context = {
          checklistId: info ? cid : null,
          personName:
            info?.name ??
            (r.tableName === "checklists" ? (r.recordLabel ?? "").split(" · ")[0] : null),
          checklistKind: info?.kind ?? null,
        };
        break;
      }
    }
    return { ...r, context };
  });
}

/** Log entries matching the filters, newest first. */
export async function listActivity(filters: ActivityFilters, limit = 500): Promise<LogEntry[]> {
  const rows = await getDb()
    .select({
      id: activityLog.id,
      at: activityLog.at,
      actor: activityLog.actor,
      action: activityLog.action,
      tableName: activityLog.tableName,
      recordId: activityLog.recordId,
      recordLabel: activityLog.recordLabel,
      module: activityLog.module,
      changes: activityLog.changes,
    })
    .from(activityLog)
    .where(where(filters, await getTimeZone()))
    .orderBy(desc(activityLog.at), desc(activityLog.id))
    .limit(limit);
  return withContext(rows);
}

/** Totals for the header, plus the modules to filter by. */
export async function activityFacets() {
  const db = getDb();
  const [[totals], modules] = await Promise.all([
    db.select({ n: count(), first: min(activityLog.at) }).from(activityLog),
    db.selectDistinct({ module: activityLog.module }).from(activityLog).orderBy(activityLog.module),
  ]);
  return {
    total: totals?.n ?? 0,
    since: totals?.first ?? null,
    modules: modules.map((m) => m.module),
  };
}

/**
 * Counts for the Module and Date tabs: each set follows every other filter, so a tab shows
 * what you would get by clicking it.
 */
export async function activityTabCounts(filters: ActivityFilters, today: string) {
  const db = getDb();
  const timeZone = await getTimeZone();
  const since = (days: number) =>
    gte(activityLog.at, startOfDayIn(addDays(today, -days), timeZone));
  const [moduleRows, [ranges]] = await Promise.all([
    db
      .select({ module: activityLog.module, n: count() })
      .from(activityLog)
      .where(where({ ...filters, module: null }, timeZone))
      .groupBy(activityLog.module),
    db
      .select({
        today: sql<number>`count(*) filter (where ${since(0)})::int`,
        week: sql<number>`count(*) filter (where ${since(6)})::int`,
        month: sql<number>`count(*) filter (where ${since(29)})::int`,
        all: sql<number>`count(*)::int`,
      })
      .from(activityLog)
      .where(where({ ...filters, from: null, to: null }, timeZone)),
  ]);
  return {
    modules: new Map(moduleRows.map((m) => [m.module, m.n])),
    ranges: {
      today: ranges?.today ?? 0,
      "7d": ranges?.week ?? 0,
      "30d": ranges?.month ?? 0,
      all: ranges?.all ?? 0,
    },
  };
}
