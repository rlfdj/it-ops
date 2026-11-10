// Sample on/offboarding checklists, shared by the seed and replace-sample-checklists.
// Built on the templates in src/lib/checklists.ts: equipment (with sub-items) + accounts.

import { eq } from "drizzle-orm";
import * as s from "../src/db/schema.ts";
import { taskTitle } from "../src/lib/checklists.ts";

type Tx = Parameters<
  Parameters<import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof s>["transaction"]>[0]
>[0];

type Piece = { label: string; detail?: string; due?: string; done?: string; na?: boolean };
type Item = {
  section: "assets" | "accounts";
  label: string;
  detail?: string;
  due: string;
  done?: string;
  /** Pieces of equipment; the parent is done when they all are. */
  pieces?: Piece[];
};
export type SampleChecklist = {
  person: string;
  kind: "onboarding" | "offboarding";
  target: string;
  createdAt: string;
  items: Item[];
  /** Mark this item's task as in progress. */
  inProgress?: string;
};

export const SAMPLE_CHECKLISTS: SampleChecklist[] = [
  {
    person: "karim",
    kind: "offboarding",
    target: "2026-10-09",
    createdAt: "2026-10-09T18:10:00+04:00",
    items: [
      {
        section: "assets",
        label: "Collect equipment",
        detail: "Tick each item as it comes back",
        due: "2026-10-09",
        pieces: [
          {
            label: "MacBook Air 13″ M2",
            detail: "DP-LT-0197 · wipe and return to IT store",
            due: "2026-10-10",
          },
          { label: "Dell P2722H 27″ monitor", done: "2026-10-09" },
          { label: "Access card", detail: "Hand to facilities", done: "2026-10-09" },
          { label: "Charger and USB-C hub" },
        ],
      },
      {
        section: "accounts",
        label: "Deactivate Microsoft 365 account",
        detail: "Forward mail to Hannah Brooks for 30 days",
        due: "2026-10-09",
      },
      {
        section: "accounts",
        label: "Deactivate Jira account",
        detail: "Reassign 14 open issues",
        due: "2026-10-09",
        done: "2026-10-12",
      },
      { section: "accounts", label: "Revoke VPN access", due: "2026-10-14" },
    ],
  },
  {
    person: "priya",
    kind: "onboarding",
    target: "2026-10-19",
    createdAt: "2026-10-12T09:12:00+04:00",
    inProgress: "Create Microsoft 365 account",
    items: [
      {
        section: "assets",
        label: "Issue equipment",
        detail: "Tick each item as it is handed over",
        due: "2026-10-19",
        pieces: [
          {
            label: "MacBook Pro 14″ M4 Pro",
            detail: "DP-LT-0238 · set up for day one",
            due: "2026-10-16",
          },
          { label: "Dell monitor and USB-C dock", detail: "From IT store" },
        ],
      },
      {
        section: "accounts",
        label: "Create Microsoft 365 account",
        detail: "priya.nair@ · groups: eng, eng-platform",
        due: "2026-10-15",
      },
      { section: "accounts", label: "Create Jira account", due: "2026-10-15", done: "2026-10-12" },
      { section: "accounts", label: "Set up VPN access", due: "2026-10-19" },
    ],
  },
  {
    person: "aisha",
    kind: "onboarding",
    target: "2026-10-12",
    createdAt: "2026-10-05T10:00:00+04:00",
    items: [
      {
        section: "assets",
        label: "Issue equipment",
        detail: "Tick each item as it is handed over",
        due: "2026-10-12",
        pieces: [
          { label: "MacBook Pro 14″ M4 Pro", detail: "Signed handover form", done: "2026-10-13" },
          { label: "Monitor and dock", done: "2026-10-12" },
        ],
      },
      {
        section: "accounts",
        label: "Create Microsoft 365 account",
        due: "2026-10-08",
        done: "2026-10-08",
      },
      { section: "accounts", label: "Create Jira account", due: "2026-10-08", done: "2026-10-08" },
      { section: "accounts", label: "Set up VPN access", due: "2026-10-16" },
    ],
  },
];

const at = (date: string, time = "17:00") => new Date(`${date}T${time}:00+04:00`);

/**
 * Inserts the sample checklists, their items/sub-items and linked tasks.
 * `people` maps the sample keys (karim, priya, aisha) to person ids and names.
 */
export async function insertSampleChecklists(
  tx: Tx,
  people: Map<string, { id: string; name: string }>,
): Promise<{ checklists: number; items: number; tasks: number }> {
  let items = 0;
  let taskCount = 0;
  for (const cl of SAMPLE_CHECKLISTS) {
    const person = people.get(cl.person);
    if (!person) throw new Error(`Unknown sample person ${cl.person}`);
    const createdAt = new Date(cl.createdAt);
    const [checklist] = await tx
      .insert(s.checklists)
      .values({ personId: person.id, kind: cl.kind, targetDate: cl.target, createdAt })
      .returning({ id: s.checklists.id });

    const allDone = cl.items.every((i) =>
      i.pieces ? i.pieces.every((p) => p.done || p.na) : Boolean(i.done),
    );
    if (allDone) {
      await tx
        .update(s.checklists)
        .set({ status: "completed" })
        .where(eq(s.checklists.id, checklist!.id));
    }

    for (const [sort, item] of cl.items.entries()) {
      // A parent with pieces is done when every piece is (on the latest piece's date).
      const pieceDates =
        item.pieces?.map((p) => p.done).filter((d): d is string => Boolean(d)) ?? [];
      const parentDone = item.pieces
        ? item.pieces.every((p) => p.done || p.na)
          ? at(pieceDates.sort().at(-1) ?? cl.target)
          : null
        : item.done
          ? at(item.done)
          : null;

      const [row] = await tx
        .insert(s.checklistItems)
        .values({
          checklistId: checklist!.id,
          section: item.section,
          sort,
          label: item.label,
          detail: item.detail,
          dueDate: item.due,
          doneAt: parentDone,
          createdAt,
        })
        .returning({ id: s.checklistItems.id });
      items++;

      for (const [i, piece] of (item.pieces ?? []).entries()) {
        await tx.insert(s.checklistItems).values({
          checklistId: checklist!.id,
          parentId: row!.id,
          section: item.section,
          sort: i,
          label: piece.label,
          detail: piece.detail,
          dueDate: piece.due ?? item.due,
          doneAt: piece.done ? at(piece.done) : null,
          notApplicable: piece.na ?? false,
          createdAt,
        });
        items++;
      }

      await tx.insert(s.tasks).values({
        title: taskTitle(item.label, person.name),
        dueDate: item.due,
        priority: item.section === "assets" ? 1 : 2,
        status: parentDone ? "done" : cl.inProgress === item.label ? "in_progress" : "open",
        doneAt: parentDone,
        source: "checklist",
        checklistItemId: row!.id,
        personId: person.id,
        createdAt,
      });
      taskCount++;
    }
  }
  return { checklists: SAMPLE_CHECKLISTS.length, items, tasks: taskCount };
}
