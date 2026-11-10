import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import {
  checklistItems,
  checklists,
  people,
  purchaseOrders,
  subscriptions,
  tasks,
  vendors,
} from "@/db/schema";
import type { TaskStatus } from "@/lib/tasks";
import { personHref, poHref, subscriptionHref } from "@/lib/links";
import { sourceShortLabel } from "@/lib/tasks";

export type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: number;
  status: TaskStatus;
  doneAt: Date | null;
  source: "manual" | "checklist" | "subscription" | "system";
  /** "Offboarding · Karim Saleh", "Manual", … */
  sourceLabel: string;
  /** What the Source column shows: just "Onboarding" when Related already names the person. */
  sourceShort: string;
  related: { label: string; href: string; mono: boolean } | null;
  /** The linked record, to pre-fill the Related field when editing. */
  relatedRef: { kind: "po" | "subscription" | "person"; id: string } | null;
  fromChecklist: boolean;
  notes: string;
};

export async function listTasks(): Promise<TaskRow[]> {
  const owner = alias(people, "owner");
  const rows = await getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      status: tasks.status,
      doneAt: tasks.doneAt,
      source: tasks.source,
      checklistItemId: tasks.checklistItemId,
      notes: tasks.notes,
      personId: people.id,
      personName: people.fullName,
      poNumber: purchaseOrders.poNumber,
      poId: purchaseOrders.id,
      subscriptionId: subscriptions.id,
      subscriptionName: subscriptions.name,
      checklistKind: checklists.kind,
      checklistPerson: owner.fullName,
    })
    .from(tasks)
    .leftJoin(people, eq(people.id, tasks.personId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, tasks.poId))
    .leftJoin(subscriptions, eq(subscriptions.id, tasks.subscriptionId))
    .leftJoin(checklistItems, eq(checklistItems.id, tasks.checklistItemId))
    .leftJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .leftJoin(owner, eq(owner.id, checklists.personId))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.priority), desc(tasks.createdAt));

  return rows.map((r) => {
    const sourceLabel =
      r.source === "checklist" && r.checklistKind
        ? `${r.checklistKind === "onboarding" ? "Onboarding" : "Offboarding"} · ${r.checklistPerson}`
        : r.source === "subscription"
          ? "Renewal reminder"
          : r.source === "system"
            ? "System"
            : "Manual";
    return {
      id: r.id,
      title: r.title,
      dueDate: r.dueDate,
      priority: r.priority,
      status: r.status,
      doneAt: r.doneAt,
      source: r.source,
      fromChecklist: Boolean(r.checklistItemId),
      notes: r.notes,
      sourceLabel,
      sourceShort: sourceShortLabel(sourceLabel, r.personId ? r.personName : null),
      relatedRef: r.poNumber
        ? { kind: "po" as const, id: r.poId! }
        : r.subscriptionId
          ? { kind: "subscription" as const, id: r.subscriptionId }
          : r.personId
            ? { kind: "person" as const, id: r.personId }
            : null,
      related: r.poNumber
        ? { label: r.poNumber, href: poHref(r.poNumber), mono: true }
        : r.subscriptionId
          ? { label: r.subscriptionName!, href: subscriptionHref(r.subscriptionId), mono: false }
          : r.personId
            ? { label: r.personName!, href: personHref(r.personId), mono: false }
            : null,
    };
  });
}

export type TaskLinkOption = {
  kind: "po" | "subscription" | "person";
  id: string;
  /** What the picker shows and matches on, e.g. "PO-2026-0158 · Dell Technologies". */
  label: string;
};

/** Existing POs, subscriptions and people a new task can be linked to. */
export async function listTaskLinkOptions(): Promise<TaskLinkOption[]> {
  const db = getDb();
  const [pos, subs, persons] = await Promise.all([
    db
      .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, vendor: vendors.name })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .orderBy(desc(purchaseOrders.requestedOn))
      .limit(300),
    db.select({ id: subscriptions.id, name: subscriptions.name }).from(subscriptions),
    db.select({ id: people.id, name: people.fullName }).from(people),
  ]);
  return [
    ...pos.map((p) => ({ kind: "po" as const, id: p.id, label: `${p.poNumber} · ${p.vendor}` })),
    ...subs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ kind: "subscription" as const, id: s.id, label: `${s.name} · Subscription` })),
    ...persons
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ kind: "person" as const, id: p.id, label: `${p.name} · Person` })),
  ];
}
