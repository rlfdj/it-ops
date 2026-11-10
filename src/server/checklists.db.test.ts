import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { checklistItems, checklists, people, tasks } from "@/db/schema";
import { client, inRollback } from "@/test/db";
import type { Tx } from "@/db/actor";
import { buildTemplateItems, STARTING_STEPS } from "@/lib/checklist-templates";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklistItem,
  restoreChecklistItem,
  setItemDone,
  setItemNotApplicable,
  updateChecklistItem,
} from "./checklists";
import { setTaskDone, updateTask } from "./tasks";

afterAll(() => client.end());

/** A fresh offboarding checklist from the template, with three pieces of equipment. */
async function offboard(tx: Tx) {
  const { checklistId, personId } = await createChecklist(tx, {
    kind: "offboarding",
    targetDate: "2026-10-20",
    person: { fullName: "Test Leaver", department: "QA", managerName: "Test Manager" },
    items: buildTemplateItems("offboarding", STARTING_STEPS.offboarding).map((t) => ({
      section: t.section,
      label: t.label,
      detail: t.detail,
      children: t.equipment ? ["MacBook Pro 14″", "Dell monitor", "Access card"] : [],
    })),
  });
  const items = await tx
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.checklistId, checklistId))
    .orderBy(checklistItems.sort);
  const top = items.filter((i) => !i.parentId);
  const equipment = top.find((i) => i.label === "Collect equipment")!;
  const pieces = items.filter((i) => i.parentId === equipment.id);
  const jira = top.find((i) => i.label === "Deactivate Jira account")!;
  return { checklistId, personId, top, equipment, pieces, jira };
}
const taskFor = async (tx: Tx, itemId: string) =>
  (await tx.select().from(tasks).where(eq(tasks.checklistItemId, itemId)))[0];
const item = async (tx: Tx, id: string) =>
  (await tx.select().from(checklistItems).where(eq(checklistItems.id, id)))[0]!;

describe("createChecklist", () => {
  it("creates items, sub-items, and one task per top-level item", async () => {
    await inRollback(async (tx) => {
      const { checklistId, personId, top, pieces } = await offboard(tx);
      expect(top.map((i) => i.label)).toEqual(
        buildTemplateItems("offboarding", STARTING_STEPS.offboarding).map((t) => t.label),
      );
      expect(pieces).toHaveLength(3);
      const created = await tx.select().from(tasks).where(eq(tasks.personId, personId));
      expect(created).toHaveLength(5); // pieces of equipment don't get their own task
      expect(created.every((t) => t.source === "checklist" && t.dueDate === "2026-10-20")).toBe(
        true,
      );
      expect(created.map((t) => t.title)).toContain("Revoke VPN and remote access — Test Leaver");
      const [person] = await tx.select().from(people).where(eq(people.id, personId));
      expect(person).toMatchObject({ status: "leaving", endDate: "2026-10-20" });
      const [cl] = await tx.select().from(checklists).where(eq(checklists.id, checklistId));
      expect(cl?.status).toBe("open");
    });
  });
});

describe("default due date (offboarding: the last day)", () => {
  it("gives items without a chosen date the last day, and keeps a chosen one", async () => {
    await inRollback(async (tx) => {
      const { checklistId, personId } = await createChecklist(tx, {
        kind: "offboarding",
        targetDate: "2026-10-20",
        person: { fullName: "Date Default" },
        items: [
          { section: "accounts", label: "Revoke VPN access" },
          { section: "accounts", label: "Deactivate Jira account", dueDate: "2026-10-15" },
          { section: "accounts", label: "Deactivate Slack account", dueDate: "" },
          { section: "assets", label: "Collect equipment", children: ["Laptop"] },
        ],
      });
      const rows = await tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistId));
      const due = (label: string) => rows.find((r) => r.label === label)?.dueDate;
      expect(due("Revoke VPN access")).toBe("2026-10-20");
      expect(due("Deactivate Jira account")).toBe("2026-10-15");
      expect(due("Deactivate Slack account")).toBe("2026-10-20");
      expect(due("Laptop")).toBe("2026-10-20");
      const linked = await tx.select().from(tasks).where(eq(tasks.personId, personId));
      expect(linked.find((t) => t.title.startsWith("Revoke VPN"))?.dueDate).toBe("2026-10-20");
      expect(linked.find((t) => t.title.startsWith("Deactivate Jira"))?.dueDate).toBe("2026-10-15");
    });
  });

  it("an item added later, or whose date is cleared, falls back to the last day", async () => {
    await inRollback(async (tx) => {
      const { checklistId } = await offboard(tx);
      const { id } = await addChecklistItem(tx, {
        checklistId,
        section: "accounts",
        label: "Remove from Slack",
        dueDate: "",
      });
      expect((await item(tx, id)).dueDate).toBe("2026-10-20");
      expect((await taskFor(tx, id))?.dueDate).toBe("2026-10-20");

      const other = await addChecklistItem(tx, {
        checklistId,
        section: "accounts",
        label: "Remove from Zoom",
        dueDate: "2026-10-16",
      });
      expect((await item(tx, other.id)).dueDate).toBe("2026-10-16");

      await updateChecklistItem(tx, { itemId: other.id, label: "Remove from Zoom", dueDate: "" });
      expect((await item(tx, other.id)).dueDate).toBe("2026-10-20");
      expect((await taskFor(tx, other.id))?.dueDate).toBe("2026-10-20");
    });
  });
});

describe("ticking (rule 5)", () => {
  it("ticking the item completes its task, with the date", async () => {
    await inRollback(async (tx) => {
      const { jira } = await offboard(tx);
      await setItemDone(tx, { itemId: jira.id, done: true });
      const task = await taskFor(tx, jira.id);
      expect(task).toMatchObject({ status: "done" });
      expect(task?.doneAt).toBeInstanceOf(Date);
      expect((await item(tx, jira.id)).doneAt).toBeInstanceOf(Date);
    });
  });

  it("ticking the task completes its item, and unticking reopens both", async () => {
    await inRollback(async (tx) => {
      const { jira } = await offboard(tx);
      const task = await taskFor(tx, jira.id);
      await setTaskDone(tx, { id: task!.id, done: true });
      expect((await item(tx, jira.id)).doneAt).toBeInstanceOf(Date);
      await setTaskDone(tx, { id: task!.id, done: false });
      expect((await item(tx, jira.id)).doneAt).toBeNull();
      expect((await taskFor(tx, jira.id))?.status).toBe("open");
    });
  });

  it("marking a checklist task done from the task editor syncs the item", async () => {
    await inRollback(async (tx) => {
      const { jira } = await offboard(tx);
      const task = await taskFor(tx, jira.id);
      await updateTask(tx, {
        id: task!.id,
        title: task!.title,
        priority: 1,
        status: "done",
        dueDate: "2026-10-20",
      });
      expect((await item(tx, jira.id)).doneAt).toBeInstanceOf(Date);
    });
  });
});

describe("equipment sub-items", () => {
  it("completes 'Collect equipment' once every piece is back", async () => {
    await inRollback(async (tx) => {
      const { equipment, pieces } = await offboard(tx);
      await setItemDone(tx, { itemId: pieces[0]!.id, done: true });
      await setItemDone(tx, { itemId: pieces[1]!.id, done: true });
      expect((await item(tx, equipment.id)).doneAt).toBeNull();
      await setItemNotApplicable(tx, { itemId: pieces[2]!.id, notApplicable: true });
      expect((await item(tx, equipment.id)).doneAt).toBeInstanceOf(Date);
      expect((await taskFor(tx, equipment.id))?.status).toBe("done");
    });
  });

  it("ticking the parent ticks every piece; unticking a piece reopens the parent", async () => {
    await inRollback(async (tx) => {
      const { equipment, pieces } = await offboard(tx);
      await setItemDone(tx, { itemId: equipment.id, done: true });
      for (const p of pieces) expect((await item(tx, p.id)).doneAt).toBeInstanceOf(Date);
      await setItemDone(tx, { itemId: pieces[0]!.id, done: false });
      expect((await item(tx, equipment.id)).doneAt).toBeNull();
      expect((await taskFor(tx, equipment.id))?.status).toBe("open");
    });
  });

  it("adding a piece to a finished parent reopens it", async () => {
    await inRollback(async (tx) => {
      const { checklistId, equipment } = await offboard(tx);
      await setItemDone(tx, { itemId: equipment.id, done: true });
      await addChecklistItem(tx, {
        checklistId,
        section: "assets",
        label: "Charger",
        parentId: equipment.id,
      });
      expect((await item(tx, equipment.id)).doneAt).toBeNull();
      expect(
        await tx.select().from(checklistItems).where(eq(checklistItems.parentId, equipment.id)),
      ).toHaveLength(4);
    });
  });
});

describe("not applicable, add, edit, delete", () => {
  it("not-applicable items have no task; making them applicable restores it", async () => {
    await inRollback(async (tx) => {
      const { jira } = await offboard(tx);
      await setItemNotApplicable(tx, { itemId: jira.id, notApplicable: true });
      expect(await taskFor(tx, jira.id)).toBeUndefined();
      await setItemNotApplicable(tx, { itemId: jira.id, notApplicable: false });
      expect((await taskFor(tx, jira.id))?.status).toBe("open");
      await expect(setItemDone(tx, { itemId: jira.id, done: true })).resolves.toBeUndefined();
    });
  });

  it("new top-level items get a task; renames carry over to the task; deleting removes it", async () => {
    await inRollback(async (tx) => {
      const { checklistId } = await offboard(tx);
      const { id } = await addChecklistItem(tx, {
        checklistId,
        section: "accounts",
        label: "Remove from Slack",
      });
      expect((await taskFor(tx, id))?.title).toBe("Remove from Slack — Test Leaver");
      await updateChecklistItem(tx, {
        itemId: id,
        label: "Remove from Slack and Zoom",
        dueDate: "2026-10-18",
      });
      expect(await taskFor(tx, id)).toMatchObject({
        title: "Remove from Slack and Zoom — Test Leaver",
        dueDate: "2026-10-18",
      });
      await deleteChecklistItem(tx, { itemId: id });
      expect(await taskFor(tx, id)).toBeUndefined();
    });
  });

  it("completes the checklist when everything is settled, and reopens it otherwise", async () => {
    await inRollback(async (tx) => {
      const { checklistId, top } = await offboard(tx);
      for (const i of top) await setItemDone(tx, { itemId: i.id, done: true });
      const status = async () =>
        (await tx.select().from(checklists).where(eq(checklists.id, checklistId)))[0]?.status;
      expect(await status()).toBe("completed");
      await setItemDone(tx, { itemId: top[1]!.id, done: false });
      expect(await status()).toBe("open");
      const open = await tx
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.checklistId, checklistId), isNull(checklistItems.doneAt)));
      expect(open.length).toBeGreaterThan(0);
    });
  });

  it("undoes removing an item: sub-items and the task come back, a repeat changes nothing", async () => {
    await inRollback(async (tx) => {
      const { checklistId, equipment, pieces } = await offboard(tx);
      await setItemDone(tx, { itemId: pieces[0]!.id, done: true });
      const snapshot = await deleteChecklistItem(tx, { itemId: equipment.id });
      expect(snapshot.items).toHaveLength(1 + pieces.length);
      expect(snapshot.tasks).toHaveLength(1);
      expect(await taskFor(tx, equipment.id)).toBeUndefined();

      const wire = JSON.parse(JSON.stringify(snapshot));
      await restoreChecklistItem(tx, wire);
      await restoreChecklistItem(tx, wire);

      const back = await tx
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistId));
      expect(back.filter((i) => i.id === equipment.id)).toHaveLength(1);
      expect(back.filter((i) => i.parentId === equipment.id)).toHaveLength(pieces.length);
      // The piece that was ticked is still ticked; the parent is still open.
      expect((await item(tx, pieces[0]!.id)).doneAt).not.toBeNull();
      expect((await item(tx, equipment.id)).doneAt).toBeNull();
      expect(
        await tx.select().from(tasks).where(eq(tasks.checklistItemId, equipment.id)),
      ).toHaveLength(1);
    });
  });

  it("undoes removing the last open piece: the parent goes back to open", async () => {
    await inRollback(async (tx) => {
      const { equipment, pieces } = await offboard(tx);
      for (const p of pieces.slice(0, 2)) await setItemDone(tx, { itemId: p.id, done: true });
      const snapshot = await deleteChecklistItem(tx, { itemId: pieces[2]!.id });
      // With only ticked pieces left, the parent completes (and so does its task).
      expect((await item(tx, equipment.id)).doneAt).not.toBeNull();
      await restoreChecklistItem(tx, snapshot);
      expect((await item(tx, equipment.id)).doneAt).toBeNull();
      expect((await taskFor(tx, equipment.id))?.status).toBe("open");
    });
  });

  it("refuses to restore into a checklist that no longer exists", async () => {
    await inRollback(async (tx) => {
      const { equipment } = await offboard(tx);
      const snapshot = await deleteChecklistItem(tx, { itemId: equipment.id });
      const missing = "00000000-0000-4000-8000-000000000000";
      await expect(
        restoreChecklistItem(tx, {
          ...snapshot,
          items: snapshot.items.map((i) => ({ ...i, checklistId: missing })),
        }),
      ).rejects.toThrow(/checklist was removed/);
    });
  });
});
