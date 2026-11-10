import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { purchaseOrders, subscriptions, tasks } from "@/db/schema";
import { client, inRollback } from "@/test/db";
import {
  bulkUpdateTasks,
  deleteTask,
  deleteTasks,
  quickAddTask,
  resolveRef,
  restoreTask,
  restoreTasks,
  restoreTaskStates,
  addTask,
  setTaskDone,
  updateTask,
} from "./tasks";

afterAll(() => client.end());

const TODAY = "2026-10-13";

describe("quick add", () => {
  it("parses @due, !priority and links a PO by #number", async () => {
    await inRollback(async (tx) => {
      const { id, linked } = await quickAddTask(
        tx,
        { text: "Chase the invoice @fri #PO-2026-0153 !1" },
        TODAY,
      );
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, id));
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.poNumber, "PO-2026-0153"));
      expect(task).toMatchObject({
        title: "Chase the invoice",
        dueDate: "2026-10-16",
        priority: 1,
        poId: po!.id,
        source: "manual",
        status: "open",
      });
      expect(linked).toBe("PO-2026-0153");
    });
  });

  it("links subscriptions and people by name", async () => {
    await inRollback(async (tx) => {
      const sub = await resolveRef(tx, "Microsoft_365");
      const [m365] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.name, "Microsoft 365 Business Premium"));
      expect(sub?.subscriptionId).toBe(m365!.id);
      expect((await resolveRef(tx, "Priya-Nair"))?.label).toBe("Priya Nair");
    });
  });

  it("refuses an unknown #ref or a missing title", async () => {
    await inRollback(async (tx) => {
      await expect(quickAddTask(tx, { text: "Do it #nothing-like-this" }, TODAY)).rejects.toThrow(
        /Nothing matches/,
      );
      await expect(quickAddTask(tx, { text: "@fri !1" }, TODAY)).rejects.toThrow(/title/);
    });
  });
});

describe("manual tasks", () => {
  it("ticks with a date, unticks, and can be deleted", async () => {
    await inRollback(async (tx) => {
      const { id } = await quickAddTask(tx, { text: "Order toner" }, TODAY);
      await setTaskDone(tx, { id, done: true });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        status: "done",
      });
      await setTaskDone(tx, { id, done: false });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        status: "open",
        doneAt: null,
      });
      await deleteTask(tx, { id });
      expect(await tx.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);
    });
  });

  it("won't delete a checklist task directly", async () => {
    await inRollback(async (tx) => {
      const [checklistTask] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.source, "checklist"))
        .limit(1);
      await expect(deleteTask(tx, { id: checklistTask!.id })).rejects.toThrow(/checklist/);
    });
  });

  it("restores a deleted task exactly as it was, and a repeat changes nothing", async () => {
    await inRollback(async (tx) => {
      const { id } = await quickAddTask(tx, { text: "Chase invoice @fri #PO-2026-0153 !1" }, TODAY);
      await setTaskDone(tx, { id, done: true });
      const [before] = await tx.select().from(tasks).where(eq(tasks.id, id));
      const snapshot = await deleteTask(tx, { id });
      expect(await tx.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(0);

      // The snapshot crosses the network as JSON, so dates arrive as strings.
      const wire = JSON.parse(JSON.stringify(snapshot));
      await restoreTask(tx, wire);
      await restoreTask(tx, wire);
      const restored = await tx.select().from(tasks).where(eq(tasks.id, id));
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        title: "Chase invoice",
        dueDate: before!.dueDate,
        priority: 1,
        status: "done",
        poId: before!.poId,
        source: "manual",
      });
      expect(restored[0]!.doneAt?.getTime()).toBe(before!.doneAt?.getTime());
    });
  });

  it("drops a link to a record that has since gone, instead of failing", async () => {
    await inRollback(async (tx) => {
      const { id } = await quickAddTask(tx, { text: "Chase invoice #PO-2026-0153" }, TODAY);
      const snapshot = await deleteTask(tx, { id });
      await restoreTask(tx, { ...snapshot, poId: "00000000-0000-4000-8000-000000000000" });
      const [restored] = await tx.select().from(tasks).where(eq(tasks.id, id));
      expect(restored).toMatchObject({ title: "Chase invoice", poId: null });
    });
  });
});

describe("bulk edits (B-16)", () => {
  type Tx = Parameters<typeof quickAddTask>[0];
  const make = (tx: Tx, text: string) => quickAddTask(tx, { text }, TODAY).then((r) => r.id);
  const get = async (tx: Tx, id: string) =>
    (await tx.select().from(tasks).where(eq(tasks.id, id)))[0]!;

  it("marks done, sets due date and priority together, and undo puts them back", async () => {
    await inRollback(async (tx) => {
      const a = await make(tx, "Bulk A @fri !1");
      const b = await make(tx, "Bulk B");
      const done = await bulkUpdateTasks(tx, { ids: [a, b], change: { kind: "done" } });
      expect(done.changed).toBe(2);
      expect((await get(tx, a)).status).toBe("done");
      await restoreTaskStates(tx, done.before);
      expect((await get(tx, a)).status).toBe("open");
      expect((await get(tx, a)).doneAt).toBeNull();

      const due = await bulkUpdateTasks(tx, {
        ids: [a, b],
        change: { kind: "due", dueDate: "2026-11-01" },
      });
      expect((await get(tx, b)).dueDate).toBe("2026-11-01");
      await restoreTaskStates(tx, due.before);
      expect((await get(tx, a)).dueDate).toBe("2026-10-16");
      expect((await get(tx, b)).dueDate).toBeNull();

      const prio = await bulkUpdateTasks(tx, {
        ids: [a, b],
        change: { kind: "priority", priority: 3 },
      });
      expect(prio.changed).toBe(2);
      expect((await get(tx, a)).priority).toBe(3);
      // A task already at the target is left alone.
      const again = await bulkUpdateTasks(tx, {
        ids: [a],
        change: { kind: "priority", priority: 3 },
      });
      expect(again.changed).toBe(0);
    });
  });

  it("deletes manual tasks, skips checklist tasks, and restores them", async () => {
    await inRollback(async (tx) => {
      const a = await make(tx, "Bulk delete me");
      const [checklistTask] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.source, "checklist"))
        .limit(1);
      const { snapshots, skipped } = await deleteTasks(tx, { ids: [a, checklistTask!.id] });
      expect(snapshots).toHaveLength(1);
      expect(skipped).toBe(1);
      expect(await tx.select().from(tasks).where(eq(tasks.id, a))).toHaveLength(0);
      expect(await tx.select().from(tasks).where(eq(tasks.id, checklistTask!.id))).toHaveLength(1);
      await restoreTasks(tx, snapshots);
      await restoreTasks(tx, snapshots);
      expect(await tx.select().from(tasks).where(eq(tasks.id, a))).toHaveLength(1);
    });
  });

  it("refuses ids that no longer exist", async () => {
    await inRollback(async (tx) => {
      await expect(
        bulkUpdateTasks(tx, {
          ids: ["00000000-0000-4000-8000-000000000000"],
          change: { kind: "done" },
        }),
      ).rejects.toThrow(/no longer exist/);
    });
  });
});

describe("Related on edit (B-23)", () => {
  it("links, keeps, re-links and clears the record of a manual task", async () => {
    await inRollback(async (tx) => {
      const { id } = await quickAddTask(tx, { text: "Link me" }, TODAY);
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.poNumber, "PO-2026-0153"));
      const [sub] = await tx.select().from(subscriptions).limit(1);
      const base = { id, title: "Link me", dueDate: "", priority: 2, status: "open" as const };
      await updateTask(tx, { ...base, related: { kind: "po", id: po!.id } });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        poId: po!.id,
      });
      // No related keeps the link.
      await updateTask(tx, { ...base, title: "Link me again" });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        poId: po!.id,
        title: "Link me again",
      });
      // A different kind replaces the old link rather than adding to it.
      await updateTask(tx, { ...base, related: { kind: "subscription", id: sub!.id } });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        poId: null,
        subscriptionId: sub!.id,
      });
      await updateTask(tx, { ...base, related: null });
      expect((await tx.select().from(tasks).where(eq(tasks.id, id)))[0]).toMatchObject({
        poId: null,
        subscriptionId: null,
        personId: null,
      });
    });
  });

  it("leaves a checklist task link alone and rejects a missing record", async () => {
    await inRollback(async (tx) => {
      const [ct] = await tx.select().from(tasks).where(eq(tasks.source, "checklist")).limit(1);
      const before = { person: ct!.personId, po: ct!.poId };
      await updateTask(tx, {
        id: ct!.id,
        title: ct!.title,
        dueDate: ct!.dueDate ?? "",
        priority: ct!.priority,
        status: ct!.status,
        related: null,
      });
      const [after] = await tx.select().from(tasks).where(eq(tasks.id, ct!.id));
      expect({ person: after!.personId, po: after!.poId }).toEqual(before);
      const { id } = await quickAddTask(tx, { text: "Nope" }, TODAY);
      await expect(
        updateTask(tx, {
          id,
          title: "Nope",
          dueDate: "",
          priority: 2,
          status: "open",
          related: { kind: "po", id: "00000000-0000-4000-8000-000000000000" },
        }),
      ).rejects.toThrow(/no longer exists/);
    });
  });
});

describe("task notes", () => {
  it("creates with notes, updates them, and leaves them when not passed", async () => {
    await inRollback(async (tx) => {
      const id = await addTask(tx, { title: "Order toner", notes: "Ask Dell for a quote.  \n" });
      const read = async () => (await tx.select().from(tasks).where(eq(tasks.id, id)))[0]!;
      expect((await read()).notes).toBe("Ask Dell for a quote.");

      const base = { id, title: "Order toner", priority: 2, status: "open" as const };
      await updateTask(tx, { ...base, dueDate: "", notes: "Quote received." });
      expect((await read()).notes).toBe("Quote received.");
      await updateTask(tx, { ...base, dueDate: "2026-10-20", status: "waiting" });
      expect(await read()).toMatchObject({ notes: "Quote received.", status: "waiting" });
      await bulkUpdateTasks(tx, { ids: [id], change: { kind: "priority", priority: 1 } });
      await setTaskDone(tx, { id, done: true });
      expect((await read()).notes).toBe("Quote received.");
      await updateTask(tx, { ...base, dueDate: "", notes: "" });
      expect((await read()).notes).toBe("");
    });
  });

  it("defaults to no notes and refuses more than 5000 characters", async () => {
    await inRollback(async (tx) => {
      const { id } = await quickAddTask(tx, { text: "Plain task" }, TODAY);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, id));
      expect(task!.notes).toBe("");
      await expect(addTask(tx, { title: "Too long", notes: "x".repeat(5001) })).rejects.toThrow();
    });
  });

  it("restores the notes when a delete is undone", async () => {
    await inRollback(async (tx) => {
      const id = await addTask(tx, { title: "Order toner", notes: "Keep this." });
      const snapshot = await deleteTask(tx, { id });
      expect(snapshot.notes).toBe("Keep this.");
      await restoreTask(tx, JSON.parse(JSON.stringify(snapshot)));
      const [restored] = await tx.select().from(tasks).where(eq(tasks.id, id));
      expect(restored!.notes).toBe("Keep this.");
      // A snapshot from before notes existed restores with none.
      await deleteTask(tx, { id });
      const old: Record<string, unknown> = { ...snapshot };
      delete old.notes;
      await restoreTask(tx, JSON.parse(JSON.stringify(old)));
      const [again] = await tx.select().from(tasks).where(eq(tasks.id, id));
      expect(again!.notes).toBe("");
    });
  });
});
