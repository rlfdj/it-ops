"use server";

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  notes,
  people,
  purchaseOrders,
  seatAssignments,
  stockItems,
  subscriptions,
  vendors,
} from "@/db/schema";
import { noteTitle } from "@/lib/board";
import { requireUser } from "@/lib/auth";
import { personHref, poHref, stockHref, subscriptionHref } from "@/lib/links";

export type SearchResult = {
  kind: "po" | "stock" | "subscription" | "seat" | "person" | "note";
  id: string;
  title: string;
  /** Rendered in mono for IDs. */
  mono: boolean;
  detail: string;
  href: string;
};

export async function searchRecords(query: string): Promise<SearchResult[]> {
  await requireUser();
  const q = z.string().trim().max(80).parse(query);
  if (q.length < 2) return [];
  // Escape LIKE wildcards so they match literally.
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const db = getDb();

  const [pos, stockRows, subs, persons, noteRows, seatRows] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        vendor: vendors.name,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .where(or(ilike(purchaseOrders.poNumber, like), ilike(vendors.name, like)))
      .orderBy(desc(purchaseOrders.requestedOn))
      .limit(5),
    db
      .select({
        id: stockItems.id,
        tag: stockItems.tag,
        model: stockItems.model,
        serial: stockItems.serialNumber,
        status: stockItems.status,
      })
      .from(stockItems)
      .where(
        or(
          ilike(stockItems.tag, like),
          ilike(stockItems.model, like),
          ilike(stockItems.serialNumber, like),
          ilike(stockItems.specifications, like),
        ),
      )
      .orderBy(stockItems.tag)
      .limit(6),
    db
      .select({
        id: subscriptions.id,
        name: subscriptions.name,
        vendor: vendors.name,
      })
      .from(subscriptions)
      .innerJoin(vendors, eq(vendors.id, subscriptions.vendorId))
      .where(or(ilike(subscriptions.name, like), ilike(vendors.name, like)))
      .orderBy(subscriptions.name)
      .limit(5),
    db
      .select({
        id: people.id,
        name: people.fullName,
        department: people.department,
        status: people.status,
      })
      .from(people)
      .where(or(ilike(people.fullName, like), ilike(people.email, like)))
      .orderBy(sql`${people.status} = 'left'`, people.fullName)
      .limit(5),
    db
      .select({ id: notes.id, text: notes.text, checklist: notes.checklist })
      .from(notes)
      .where(
        and(
          isNull(notes.deletedAt),
          or(ilike(notes.text, like), sql`${notes.checklist}::text ilike ${like}`),
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(5),
    db
      .select({
        id: seatAssignments.id,
        person: seatAssignments.personName,
        tier: seatAssignments.tier,
        project: seatAssignments.project,
        subscriptionId: subscriptions.id,
        subscription: subscriptions.name,
      })
      .from(seatAssignments)
      .innerJoin(subscriptions, eq(subscriptions.id, seatAssignments.subscriptionId))
      .where(
        and(
          isNull(seatAssignments.until),
          or(
            ilike(seatAssignments.personName, like),
            sql`${seatAssignments.personId} in (select id from people where full_name ilike ${like})`,
          ),
        ),
      )
      .orderBy(seatAssignments.personName)
      .limit(5),
  ]);

  return [
    ...pos.map((p) => ({
      kind: "po" as const,
      id: p.id,
      title: p.poNumber,
      mono: true,
      detail: `${p.vendor} · ${p.status[0]!.toUpperCase()}${p.status.slice(1)}`,
      href: poHref(p.poNumber),
    })),
    ...stockRows.map((a) => ({
      kind: "stock" as const,
      id: a.id,
      title: a.tag,
      mono: true,
      detail: [a.model, a.serial, a.status === "in_stock" ? null : a.status]
        .filter(Boolean)
        .join(" · "),
      href: stockHref(a.tag, a.status),
    })),
    ...subs.map((s) => ({
      kind: "subscription" as const,
      id: s.id,
      title: s.name,
      mono: false,
      detail: s.vendor,
      href: subscriptionHref(s.id),
    })),
    ...seatRows.map((s) => ({
      kind: "seat" as const,
      id: s.id,
      title: s.person,
      mono: false,
      detail: [s.subscription, s.tier === "premium" ? "Premium" : "Standard", s.project]
        .filter(Boolean)
        .join(" · "),
      href: subscriptionHref(s.subscriptionId),
    })),
    ...persons.map((p) => ({
      kind: "person" as const,
      id: p.id,
      title: p.name,
      mono: false,
      detail: [p.department, p.status === "active" ? null : p.status].filter(Boolean).join(" · "),
      href: personHref(p.id),
    })),
    ...noteRows.map((n) => ({
      kind: "note" as const,
      id: n.id,
      title: noteTitle(n.text, n.checklist),
      mono: false,
      detail: "Note on the Board",
      href: `/board?note=${n.id}`,
    })),
  ];
}
