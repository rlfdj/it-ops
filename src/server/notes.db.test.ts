import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { activityLog, documents, notes, purchaseOrders, tasks } from "@/db/schema";
import { MAX_ATTACHMENTS, arrangeGrid } from "@/lib/board";
import { client, inRollback } from "@/test/db";
import { documentDownloadName } from "./documents";
import {
  createNote,
  deleteNote,
  makeTaskFromNote,
  purgeDeletedNotes,
  recordNoteDocument,
  removeNoteDocument,
  restoreNote,
  saveNoteLayouts,
  setNoteLink,
  updateNoteContent,
} from "./notes";

afterAll(() => client.end());

const logFor = (tx: Parameters<Parameters<typeof inRollback>[0]>[0], id: string) =>
  tx.select().from(activityLog).where(eq(activityLog.recordId, id)).orderBy(activityLog.id);

describe("notes", () => {
  it("creates a note in front of the others, clamped to the board", async () => {
    await inRollback(async (tx) => {
      const a = await createNote(tx, { x: 30, y: 40, text: "First" });
      const b = await createNote(tx, { x: -50, y: 10, width: 10, height: 10 });
      const [first] = await tx.select().from(notes).where(eq(notes.id, a));
      const [second] = await tx.select().from(notes).where(eq(notes.id, b));
      expect(first).toMatchObject({ x: 30, y: 40, text: "First", colour: "yellow" });
      expect(second).toMatchObject({ x: 0, width: 160, height: 140 });
      expect(second!.zIndex).toBeGreaterThan(first!.zIndex);
    });
  });

  it("accepts an id chosen by the browser", async () => {
    await inRollback(async (tx) => {
      const id = crypto.randomUUID();
      expect(await createNote(tx, { id, x: 0, y: 0 })).toBe(id);
    });
  });

  it("saves text, checklist and colour, and logs them under Board", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { text: "Call Dell" });
      await updateNoteContent(tx, {
        id,
        text: "Call Dell about the invoice",
        colour: "pink",
        checklist: [
          { id: "l1", text: "Find the PO", done: true },
          { id: "l2", text: "Phone", done: false },
        ],
      });
      const [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ text: "Call Dell about the invoice", colour: "pink" });
      expect(row!.checklist).toHaveLength(2);

      const log = await logFor(tx, id);
      expect(log.map((l) => l.action)).toEqual(["insert", "update"]);
      expect(log.every((l) => l.module === "Board" && l.tableName === "notes")).toBe(true);
      expect(log[1]!.recordLabel).toBe("Call Dell about the invoice");
      expect(Object.keys(log[1]!.changes).sort()).toEqual(["checklist", "colour", "text"]);
    });
  });

  it("rejects an unknown colour and a missing note", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      await expect(updateNoteContent(tx, { id, colour: "purple" as never })).rejects.toThrow();
      await expect(updateNoteContent(tx, { id: crypto.randomUUID(), text: "x" })).rejects.toThrow(
        /no longer exists/,
      );
    });
  });

  it("does not log moving or resizing a note", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { x: 24, y: 24, text: "Moved" });
      await saveNoteLayouts(tx, [{ id, x: 300, y: 220, width: 300, height: 260, zIndex: 9 }]);
      const [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ x: 300, y: 220, width: 300, height: 260, zIndex: 9 });
      // Only the insert is in the log; the move added nothing.
      expect((await logFor(tx, id)).map((l) => l.action)).toEqual(["insert"]);
    });
  });

  it("saves an Arrange of several notes in one write, without logging it, and Undo restores", async () => {
    await inRollback(async (tx) => {
      const ids = [
        await createNote(tx, { x: 700, y: 500, text: "E2E a" }),
        await createNote(tx, { x: 20, y: 30, text: "E2E b" }),
        await createNote(tx, { x: 300, y: 40, text: "E2E c" }),
      ];
      const rows = await tx.select().from(notes).where(inArray(notes.id, ids));
      const spots = arrangeGrid(rows, 800);
      const items = (pos: { id: string; x: number; y: number }[]) =>
        pos.map((p) => {
          const n = rows.find((r) => r.id === p.id)!;
          return { id: p.id, x: p.x, y: p.y, width: n.width, height: n.height, zIndex: n.zIndex };
        });
      await saveNoteLayouts(tx, items(spots));
      const after = await tx.select().from(notes).where(inArray(notes.id, ids));
      for (const s of spots)
        expect(after.find((r) => r.id === s.id)).toMatchObject({ x: s.x, y: s.y });
      for (const id of ids) expect((await logFor(tx, id)).map((l) => l.action)).toEqual(["insert"]);
      // Undo: the earlier positions go back.
      await saveNoteLayouts(tx, items(rows.map((r) => ({ id: r.id, x: r.x, y: r.y }))));
      const back = await tx.select().from(notes).where(inArray(notes.id, ids));
      for (const r of rows)
        expect(back.find((b) => b.id === r.id)).toMatchObject({ x: r.x, y: r.y });
    });
  });

  it("clamps saved layouts and skips notes that are gone", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      await saveNoteLayouts(tx, [
        { id, x: -5, y: 1e9, width: 5000, height: 1, zIndex: 3 },
        { id: crypto.randomUUID(), x: 1, y: 1, width: 200, height: 200, zIndex: 1 },
      ]);
      const [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ x: 0, width: 640, height: 140 });
      expect(row!.y + row!.height).toBe(20000);
    });
  });
});

describe("linked record and Make task", () => {
  it("links a PO, replaces it with a task link, and clears it", async () => {
    await inRollback(async (tx) => {
      const [po] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).limit(1);
      const id = await createNote(tx, { text: "Chase" });
      await setNoteLink(tx, { id, related: { kind: "po", id: po!.id } });
      let [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ poId: po!.id, taskId: null });

      const [task] = await tx.insert(tasks).values({ title: "Existing" }).returning();
      await setNoteLink(tx, { id, related: { kind: "task", id: task!.id } });
      [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ poId: null, taskId: task!.id });

      await setNoteLink(tx, { id, related: null });
      [row] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(row).toMatchObject({ poId: null, taskId: null });
    });
  });

  it("refuses a record that does not exist", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      await expect(
        setNoteLink(tx, { id, related: { kind: "person", id: crypto.randomUUID() } }),
      ).rejects.toThrow(/no longer exists/);
    });
  });

  it("makes a task from the note text, keeps the link, and has no due date", async () => {
    await inRollback(async (tx) => {
      const [po] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).limit(1);
      const id = await createNote(tx, { text: "Call Dell\nabout the invoice" });
      await setNoteLink(tx, { id, related: { kind: "po", id: po!.id } });
      const { taskId, title } = await makeTaskFromNote(tx, { id });
      expect(title).toBe("Call Dell · about the invoice");
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      expect(task).toMatchObject({
        title,
        poId: po!.id,
        dueDate: null,
        status: "open",
        source: "manual",
      });
      const [note] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(note!.madeTaskId).toBe(taskId);
      const log = await logFor(tx, id);
      expect(log.at(-1)!.changes).toHaveProperty("made_task_id");
      // The task's own creation is logged under Tasks.
      const taskLog = await logFor(tx, taskId);
      expect(taskLog[0]).toMatchObject({ module: "Tasks", action: "insert" });
    });
  });

  it("uses the checklist when there is no text, and refuses an empty note", async () => {
    await inRollback(async (tx) => {
      const withList = await createNote(tx, {});
      await updateNoteContent(tx, {
        id: withList,
        checklist: [{ id: "a", text: "Order cables", done: false }],
      });
      expect((await makeTaskFromNote(tx, { id: withList })).title).toBe("Order cables");
      const empty = await createNote(tx, { text: "  " });
      await expect(makeTaskFromNote(tx, { id: empty })).rejects.toThrow(/Write something/);
    });
  });
});

describe("blank notes stay out of the log", () => {
  it("does not log a blank note being added, recoloured or deleted", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { x: 40, y: 40 });
      await updateNoteContent(tx, { id, text: "  \n ", colour: "blue" });
      await updateNoteContent(tx, {
        id,
        text: "",
        checklist: [{ id: "l1", text: " ", done: false }],
      });
      await deleteNote(tx, { id });
      await restoreNote(tx, { id });
      await deleteNote(tx, { id });
      expect(await logFor(tx, id)).toEqual([]);
    });
  });

  it("logs a note's first content as the note being added, then edits as usual", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { x: 40, y: 40 });
      await updateNoteContent(tx, { id, text: "Renew the VPN licence", colour: "green" });
      await updateNoteContent(tx, { id, text: "Renew the VPN licence by Friday" });
      await deleteNote(tx, { id });
      const log = await logFor(tx, id);
      expect(log.map((l) => l.action)).toEqual(["insert", "update", "update"]);
      expect(log[0]!.recordLabel).toBe("Renew the VPN licence");
      expect(log[0]!.changes).toMatchObject({
        text: { old: null, new: "Renew the VPN licence" },
        colour: { old: null, new: "green" },
      });
      expect(Object.keys(log[2]!.changes)).toEqual(["deleted_at"]);
    });
  });

  it("counts a checklist line or a linked record as content", async () => {
    await inRollback(async (tx) => {
      const a = await createNote(tx, { x: 0, y: 0 });
      await updateNoteContent(tx, {
        id: a,
        text: "",
        checklist: [{ id: "l1", text: "Buy cables", done: false }],
      });
      expect((await logFor(tx, a)).map((l) => l.action)).toEqual(["insert"]);
      const [task] = await tx.insert(tasks).values({ title: "TEST link" }).returning();
      const b = await createNote(tx, { x: 0, y: 0 });
      await setNoteLink(tx, { id: b, related: { kind: "task", id: task!.id } });
      expect((await logFor(tx, b)).map((l) => l.action)).toEqual(["insert"]);
    });
  });

  it("still logs deleting a note that was logged, even once emptied", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { text: "Draft" });
      await updateNoteContent(tx, { id, text: "" });
      await deleteNote(tx, { id });
      expect((await logFor(tx, id)).map((l) => l.action)).toEqual(["insert", "update", "update"]);
    });
  });
});

describe("deleting", () => {
  it("hides a deleted note, restores it, and logs both", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { text: "Temp" });
      await deleteNote(tx, { id });
      const [hidden] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(hidden!.deletedAt).not.toBeNull();
      await expect(updateNoteContent(tx, { id, text: "edit" })).rejects.toThrow();
      await restoreNote(tx, { id });
      await restoreNote(tx, { id }); // twice is safe
      const [back] = await tx.select().from(notes).where(eq(notes.id, id));
      expect(back!.deletedAt).toBeNull();
      const log = await logFor(tx, id);
      expect(log.map((l) => Object.keys(l.changes))).toEqual([
        expect.arrayContaining(["text"]),
        ["deleted_at"],
        ["deleted_at"],
      ]);
    });
  });

  it("purges a deleted note and its files without logging again", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, { text: "Gone" });
      const doc = await recordNoteDocument(tx, {
        noteId: id,
        storagePath: `notes/${id}/test-a.png`,
        fileName: "a.png",
        sizeBytes: 100,
      });
      await deleteNote(tx, { id });
      const before = (await logFor(tx, id)).length;
      expect(await purgeDeletedNotes(tx, { id })).toEqual([`notes/${id}/test-a.png`]);
      expect(await tx.select().from(notes).where(eq(notes.id, id))).toHaveLength(0);
      expect(await tx.select().from(documents).where(eq(documents.id, doc.id))).toHaveLength(0);
      expect((await logFor(tx, id)).length).toBe(before);
      expect(await logFor(tx, doc.id)).toHaveLength(1); // only the attach
      await expect(restoreNote(tx, { id })).rejects.toThrow(/already removed/);
    });
  });

  it("never purges a note that is not deleted", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      expect(await purgeDeletedNotes(tx, { id })).toEqual([]);
      expect(await tx.select().from(notes).where(eq(notes.id, id))).toHaveLength(1);
    });
  });
});

describe("attachments", () => {
  it("attaches and removes files, logged under Board", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      const doc = await recordNoteDocument(tx, {
        noteId: id,
        storagePath: `notes/${id}/x-shot.png`,
        fileName: "shot.png",
        sizeBytes: 2048,
      });
      const [row] = await tx.select().from(documents).where(eq(documents.id, doc.id));
      expect(row).toMatchObject({
        ownerType: "note",
        ownerId: id,
        kind: "other",
        fileName: "shot.png",
      });
      expect(await documentDownloadName(tx, doc.id)).toBe("shot.png");

      const [attached] = await logFor(tx, doc.id);
      expect(attached).toMatchObject({
        module: "Board",
        action: "insert",
        recordLabel: "shot.png",
      });

      expect(await removeNoteDocument(tx, { id: doc.id })).toBe(`notes/${id}/x-shot.png`);
      const log = await logFor(tx, doc.id);
      expect(log.map((l) => [l.action, l.module])).toEqual([
        ["insert", "Board"],
        ["delete", "Board"],
      ]);
      await expect(removeNoteDocument(tx, { id: doc.id })).rejects.toThrow(/already gone/);
    });
  });

  it("limits the files on one note and needs a live note", async () => {
    await inRollback(async (tx) => {
      const id = await createNote(tx, {});
      for (let i = 0; i < MAX_ATTACHMENTS; i++)
        await recordNoteDocument(tx, {
          noteId: id,
          storagePath: `notes/${id}/${i}.png`,
          fileName: `${i}.png`,
          sizeBytes: 10,
        });
      await expect(
        recordNoteDocument(tx, {
          noteId: id,
          storagePath: `notes/${id}/extra.png`,
          fileName: "extra.png",
          sizeBytes: 10,
        }),
      ).rejects.toThrow(/up to 10 files/);
      await expect(
        recordNoteDocument(tx, {
          noteId: crypto.randomUUID(),
          storagePath: "notes/x/y.png",
          fileName: "y.png",
          sizeBytes: 10,
        }),
      ).rejects.toThrow(/no longer exists/);
      const files = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.ownerType, "note"), eq(documents.ownerId, id)));
      expect(files).toHaveLength(MAX_ATTACHMENTS);
    });
  });
});
