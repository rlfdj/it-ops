import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { documents, notes, people, purchaseOrders, subscriptions, tasks } from "@/db/schema";
import { listTaskLinkOptions } from "@/lib/queries/tasks";
import { personHref, poHref, subscriptionHref, taskHref } from "@/lib/links";
import { isImageName, type ChecklistLine, type NoteColour } from "@/lib/board";

export type NoteLink = {
  kind: "po" | "subscription" | "person" | "task";
  id: string;
  label: string;
  href: string;
};

export type NoteAttachment = {
  id: string;
  fileName: string;
  sizeBytes: number;
  image: boolean;
};

export type BoardNote = {
  id: string;
  text: string;
  colour: NoteColour;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  checklist: ChecklistLine[];
  link: NoteLink | null;
  /** The task made from this note, if it still exists. */
  madeTaskId: string | null;
  attachments: NoteAttachment[];
};

export type NoteLinkOption = {
  kind: "po" | "subscription" | "person" | "task";
  id: string;
  label: string;
};

export const attachmentOf = (d: {
  id: string;
  fileName: string;
  sizeBytes: number;
}): NoteAttachment => ({
  id: d.id,
  fileName: d.fileName,
  sizeBytes: d.sizeBytes,
  image: isImageName(d.fileName),
});

const SELECT = {
  id: notes.id,
  text: notes.text,
  colour: notes.colour,
  x: notes.x,
  y: notes.y,
  width: notes.width,
  height: notes.height,
  zIndex: notes.zIndex,
  checklist: notes.checklist,
  madeTaskId: notes.madeTaskId,
  personId: notes.personId,
  poId: notes.poId,
  subscriptionId: notes.subscriptionId,
  taskId: notes.taskId,
};

type Row = {
  personId: string | null;
  poId: string | null;
  subscriptionId: string | null;
  taskId: string | null;
};

/** The label and href of the record a note is linked to (one query per kind that is used). */
async function linksFor(rows: Row[]): Promise<Map<string, NoteLink>> {
  const db = getDb();
  const out = new Map<string, NoteLink>();
  const ids = (pick: (r: Row) => string | null) => [
    ...new Set(rows.map(pick).filter((v): v is string => Boolean(v))),
  ];
  const [pos, subs, persons, taskRows] = await Promise.all([
    ids((r) => r.poId).length
      ? db
          .select({ id: purchaseOrders.id, label: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(
            inArray(
              purchaseOrders.id,
              ids((r) => r.poId),
            ),
          )
      : [],
    ids((r) => r.subscriptionId).length
      ? db
          .select({ id: subscriptions.id, label: subscriptions.name })
          .from(subscriptions)
          .where(
            inArray(
              subscriptions.id,
              ids((r) => r.subscriptionId),
            ),
          )
      : [],
    ids((r) => r.personId).length
      ? db
          .select({ id: people.id, label: people.fullName })
          .from(people)
          .where(
            inArray(
              people.id,
              ids((r) => r.personId),
            ),
          )
      : [],
    ids((r) => r.taskId).length
      ? db
          .select({ id: tasks.id, label: tasks.title })
          .from(tasks)
          .where(
            inArray(
              tasks.id,
              ids((r) => r.taskId),
            ),
          )
      : [],
  ]);
  for (const p of pos)
    out.set(p.id, { kind: "po", id: p.id, label: p.label, href: poHref(p.label) });
  for (const s of subs)
    out.set(s.id, { kind: "subscription", id: s.id, label: s.label, href: subscriptionHref(s.id) });
  for (const p of persons)
    out.set(p.id, { kind: "person", id: p.id, label: p.label, href: personHref(p.id) });
  for (const t of taskRows)
    out.set(t.id, { kind: "task", id: t.id, label: t.label, href: taskHref(t.id) });
  return out;
}

const linkOf = (r: Row, links: Map<string, NoteLink>): NoteLink | null => {
  const id = r.poId ?? r.subscriptionId ?? r.personId ?? r.taskId;
  return id ? (links.get(id) ?? null) : null;
};

/** Every note on the board, with its link and attached files. */
export async function listBoard(): Promise<BoardNote[]> {
  const db = getDb();
  const rows = await db.select(SELECT).from(notes).where(isNull(notes.deletedAt));
  if (!rows.length) return [];
  const [links, docs] = await Promise.all([
    linksFor(rows),
    db
      .select({
        id: documents.id,
        ownerId: documents.ownerId,
        fileName: documents.fileName,
        sizeBytes: documents.sizeBytes,
      })
      .from(documents)
      .where(
        and(
          eq(documents.ownerType, "note"),
          inArray(
            documents.ownerId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(documents.uploadedAt),
  ]);
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    colour: r.colour,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    zIndex: r.zIndex,
    checklist: r.checklist,
    link: linkOf(r, links),
    madeTaskId: r.madeTaskId,
    attachments: docs.filter((d) => d.ownerId === r.id).map(attachmentOf),
  }));
}

/** One note's link after it changed (for the action's reply). */
export async function getNoteLink(id: string): Promise<NoteLink | null> {
  const [row] = await getDb().select(SELECT).from(notes).where(eq(notes.id, id));
  if (!row) return null;
  return linkOf(row, await linksFor([row]));
}

/** What a note can be linked to: POs, subscriptions, people (as for tasks) and open tasks. */
export async function listNoteLinkOptions(): Promise<NoteLinkOption[]> {
  const [base, open] = await Promise.all([
    listTaskLinkOptions(),
    getDb()
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(ne(tasks.status, "done"))
      .limit(300),
  ]);
  return [
    ...base,
    ...open.map((t) => ({ kind: "task" as const, id: t.id, label: `${t.title} · Task` })),
  ];
}
