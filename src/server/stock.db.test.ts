import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, people, stockItems } from "@/db/schema";
import { client, inRollback } from "@/test/db";
import {
  addStock,
  checkInStock,
  checkOutStock,
  checkStockImport,
  importStock,
  retireStock,
  setStockSerial,
  updateStockItem,
} from "./stock";

afterAll(() => client.end());

const item = (
  tag: string,
  extra: Partial<{ serialNumber: string; specifications: string; notes: string }> = {},
) => ({
  tag,
  model: "Logitech MX Keys S",
  ...extra,
});

describe("stock list", () => {
  it("adds items with the tags typed in, plus serials, specifications and notes", async () => {
    await inRollback(async (tx) => {
      const tags = await addStock(tx, {
        items: [
          item("TEST-KB-1", {
            serialNumber: "SN-A",
            specifications: "Wireless, UK layout",
            notes: "Shelf B2",
          }),
          item("TEST-KB-2"),
        ],
      });
      expect(tags).toEqual(["TEST-KB-1", "TEST-KB-2"]);
      const [row] = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-KB-1"));
      expect(row).toMatchObject({
        serialNumber: "SN-A",
        specifications: "Wireless, UK layout",
        notes: "Shelf B2",
      });
      const [blank] = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-KB-2"));
      expect(blank).toMatchObject({ serialNumber: null, specifications: null, notes: null });
    });
  });

  it("refuses a tag that is already in stock, or entered twice", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, { items: [item("TEST-DUP")] });
      await expect(addStock(tx, { items: [item("TEST-DUP")] })).rejects.toThrow(
        /TEST-DUP is already in stock/,
      );
      await expect(addStock(tx, { items: [item("TEST-X"), item("test-x")] })).rejects.toThrow(
        /entered twice/,
      );
      await expect(addStock(tx, { items: [{ tag: "  ", model: "x" }] })).rejects.toThrow(
        /needs a tag/,
      );
    });
  });

  it("edits an item, including its tag and serial", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, { items: [item("TEST-MN-1"), item("TEST-MN-2")] });
      const [row] = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-MN-1"));
      await expect(
        updateStockItem(tx, { id: row!.id, tag: "TEST-MN-2", model: "Dell" }),
      ).rejects.toThrow(/already in stock/);
      await updateStockItem(tx, {
        id: row!.id,
        tag: "TEST-MN-9",
        model: "Dell P2725H 27″",
        specifications: "27″ IPS, USB-C",
        notes: "Box opened",
      });
      await setStockSerial(tx, { id: row!.id, serialNumber: "CN0TEST" });
      const [after] = await tx.select().from(stockItems).where(eq(stockItems.id, row!.id));
      expect(after).toMatchObject({
        tag: "TEST-MN-9",
        model: "Dell P2725H 27″",
        specifications: "27″ IPS, USB-C",
        notes: "Box opened",
        serialNumber: "CN0TEST",
      });
    });
  });

  it("checks out to a person, keeps the row, and checks back in", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, { items: [item("TEST-TB-1"), item("TEST-TB-2")] });
      const rows = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-TB-1"));
      const id = rows[0]!.id;
      const [person] = await tx
        .insert(people)
        .values({ fullName: "Test Person Stock" })
        .returning({ id: people.id });

      const out = await checkOutStock(tx, {
        ids: [id],
        issuedTo: "test person stock",
        issuedOn: "2026-10-14",
        note: "Laptop for new hire",
      });
      expect(out).toEqual(["TEST-TB-1"]);
      const [deployed] = await tx.select().from(stockItems).where(eq(stockItems.id, id));
      expect(deployed).toMatchObject({
        status: "deployed",
        issuedToName: "test person stock",
        assignedPersonId: person!.id,
        issuedOn: "2026-10-14",
        issueNote: "Laptop for new hire",
      });
      // Not logged in the activity log (stock deliberately is not).
      expect(await tx.select().from(activityLog).where(eq(activityLog.recordId, id))).toHaveLength(
        0,
      );
      await expect(
        checkOutStock(tx, { ids: [id], issuedTo: "X", issuedOn: "2026-10-14" }),
      ).rejects.toThrow(/no longer in stock/);
      await expect(
        checkOutStock(tx, { ids: [id], issuedTo: " ", issuedOn: "2026-10-14" }),
      ).rejects.toThrow(/issued to/);

      expect(await checkInStock(tx, { ids: [id] })).toEqual(["TEST-TB-1"]);
      const [back] = await tx.select().from(stockItems).where(eq(stockItems.id, id));
      expect(back).toMatchObject({
        status: "in_stock",
        issuedToName: null,
        assignedPersonId: null,
        issuedOn: null,
        issueNote: null,
      });
      await expect(checkInStock(tx, { ids: [id] })).rejects.toThrow(/already in stock/);
    });
  });

  it("retires units and brings them back, and a free-text name needs no matching person", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, { items: [item("TEST-RT-1")] });
      const [row] = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-RT-1"));
      await retireStock(tx, { ids: [row!.id] });
      expect(
        (await tx.select().from(stockItems).where(eq(stockItems.id, row!.id)))[0],
      ).toMatchObject({ status: "retired" });
      await expect(retireStock(tx, { ids: [row!.id] })).rejects.toThrow(/already retired/);
      await checkInStock(tx, { ids: [row!.id] });
      await checkOutStock(tx, {
        ids: [row!.id],
        issuedTo: "Someone Not In People",
        issuedOn: "2026-10-14",
      });
      expect(
        (await tx.select().from(stockItems).where(eq(stockItems.id, row!.id)))[0],
      ).toMatchObject({
        status: "deployed",
        assignedPersonId: null,
        issuedToName: "Someone Not In People",
      });
    });
  });

  it("imports stock rows in one transaction and reports per-row problems", async () => {
    await inRollback(async (tx) => {
      await addStock(tx, { items: [item("TEST-IMP-0")] });
      const rows = [
        { tag: "TEST-IMP-1", model: "Dell", serialNumber: "S1", specifications: "", notes: "" },
        { tag: "test-imp-0", model: "Dup of existing" },
        { tag: "TEST-IMP-1", model: "Dup in file" },
        { tag: "", model: "No tag" },
        { tag: "TEST-IMP-2", model: "" },
      ];
      const check = await checkStockImport(tx, rows);
      expect(check.ok).toBe(false);
      expect(check.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
      expect(check.errors[0]!.message).toMatch(/already on the stock list/);
      expect(check.errors[1]!.message).toMatch(/repeats row 1/);
      await expect(importStock(tx, rows)).rejects.toThrow(/nothing was imported/);
      expect(
        await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-IMP-1")),
      ).toHaveLength(0);

      const count = await importStock(tx, [rows[0]!, { tag: "TEST-IMP-3", model: "HP" }]);
      expect(count).toBe(2);
      const [one] = await tx.select().from(stockItems).where(eq(stockItems.tag, "TEST-IMP-1"));
      expect(one).toMatchObject({
        model: "Dell",
        serialNumber: "S1",
        specifications: null,
        status: "in_stock",
      });
    });
  });
});
