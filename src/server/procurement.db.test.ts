import { afterAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { activityLog, documents, poLines, poTotals, purchaseOrders, vendors } from "@/db/schema";
import { poTotal } from "@/lib/procurement";
import { nameSegment } from "@/lib/document-names";
import { documentDownloadName } from "./documents";
import { client, inRollback, TEST_ACTOR } from "@/test/db";
import type { Tx } from "@/db/actor";
import {
  advancePo,
  closeDeliveredPos,
  createPo,
  recordPoDocument,
  setInvoiceDate,
  reopenClosedPos,
  updatePo,
} from "./procurement";

afterAll(() => client.end());

async function poByNumber(tx: Tx, poNumber: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, poNumber));
  if (!po) throw new Error(`Seed PO ${poNumber} not found — run pnpm db:seed --yes`);
  return po;
}

const pdf = (poId: string, name: string) => ({
  storagePath: `purchase-orders/${poId}/${name}`,
  fileName: name,
  sizeBytes: 1234,
});

describe("createPo", () => {
  it("numbers the PO PO-YYYY-NNNN, creates lines and logs the actor", async () => {
    await inRollback(async (tx) => {
      const { id, poNumber } = await createPo(tx, {
        vendorName: "jumbo electronics", // matches the existing vendor case-insensitively
        requestedOn: "2026-10-13",
        lines: [{ description: "USB-C dock", qty: 2, unitPriceAed: 499 }],
      });
      expect(poNumber).toMatch(/^PO-\d{4}-\d{4}$/);
      const lines = await tx.select().from(poLines).where(eq(poLines.poId, id));
      expect(lines).toHaveLength(1);
      const [log] = await tx
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.recordId, id), eq(activityLog.action, "insert")));
      expect(log?.actor).toBe(TEST_ACTOR);
      expect(log?.module).toBe("Procurement");
      expect(log?.recordLabel).toBe(poNumber);
    });
  });

  it("gives consecutive POs consecutive numbers", async () => {
    await inRollback(async (tx) => {
      const input = {
        vendorName: "Emitac",
        requestedOn: "2026-10-13",
        lines: [{ description: "Cable", qty: 1, unitPriceAed: 10 }],
      };
      const a = await createPo(tx, input);
      const b = await createPo(tx, input);
      expect(Number(b.poNumber.slice(-4))).toBe(Number(a.poNumber.slice(-4)) + 1);
    });
  });
});

describe("recordPoDocument (auto-approval)", () => {
  it("moves a requested PO to approved when an approval is attached, and logs it", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0158");
      expect(po.status).toBe("requested");
      const result = await recordPoDocument(tx, {
        poId: po.id,
        kind: "approval",
        ...pdf(po.id, "apr.pdf"),
      });
      expect(result.approved).toBe(true);
      expect((await poByNumber(tx, "PO-2026-0158")).status).toBe("approved");

      const [log] = await tx
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.recordId, po.id), eq(activityLog.action, "update")))
        .orderBy(desc(activityLog.id));
      expect(log?.changes).toMatchObject({ status: { old: "requested", new: "approved" } });
      expect(log?.actor).toBe(TEST_ACTOR);
    });
  });

  it("does not change the stage for other documents", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0157");
      const result = await recordPoDocument(tx, {
        poId: po.id,
        kind: "invoice",
        ...pdf(po.id, "inv.pdf"),
      });
      expect(result.approved).toBe(false);
      expect((await poByNumber(tx, "PO-2026-0157")).status).toBe("requested");
    });
  });

  it("replaces an earlier file of the same kind and returns its path", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0148");
      const result = await recordPoDocument(tx, {
        poId: po.id,
        kind: "invoice",
        ...pdf(po.id, "new.pdf"),
      });
      expect(result.replacedPaths).toHaveLength(1);
      const invoices = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.ownerId, po.id), eq(documents.kind, "invoice")));
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({
        originalName: "new.pdf",
        storagePath: pdf(po.id, "new.pdf").storagePath,
      });
      expect(invoices[0]?.fileName).toMatch(/^.+_Invoice_\d{4}-\d{2}-\d{2}\.pdf$/);
    });
  });

  it("names the upload with the project and invoice number, and renames when they change", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0148");
      const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, po.vendorId));
      const v = nameSegment(vendor!.name);
      await updatePo(tx, {
        id: po.id,
        vendorName: vendor!.name,
        requestedOn: po.requestedOn,
        notes: null,
        status: po.status,
        project: "Bidding",
        invoiceNumber: "INV-123",
        lines: (await tx.select().from(poLines).where(eq(poLines.poId, po.id))).map((l) => ({
          id: l.id,
          description: l.description,
          qty: l.qty,
          unitPriceAed: Number(l.unitPriceAed),
        })),
      });
      const result = await recordPoDocument(tx, {
        poId: po.id,
        kind: "invoice",
        ...pdf(po.id, "scan.pdf"),
      });
      expect(result.fileName).toMatch(
        new RegExp(`^INV-123_${v}_Bidding_Invoice_\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
      );
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.ownerId, po.id), eq(documents.kind, "invoice")));
      expect(await documentDownloadName(tx, doc!.id)).toBe(result.fileName);

      await tx
        .update(purchaseOrders)
        .set({ project: "Fit-out", invoiceNumber: null })
        .where(eq(purchaseOrders.id, po.id));
      expect(await documentDownloadName(tx, doc!.id)).toMatch(
        new RegExp(`^${v}_Fit-out_Invoice_\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
      );
      await tx
        .update(purchaseOrders)
        .set({ invoiceNumber: "A/7" })
        .where(eq(purchaseOrders.id, po.id));
      expect(await documentDownloadName(tx, doc!.id)).toMatch(/^A7_/);
    });
  });

  it("renames the upload Vendor_Type_Date.ext, keeping the original name", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0158");
      const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, po.vendorId));
      const stem = nameSegment(vendor!.name);
      const result = await recordPoDocument(
        tx,
        {
          poId: po.id,
          kind: "delivery_note",
          ...pdf(po.id, "Scan 0042.PDF"),
          mimeType: "application/pdf",
        },
        "2031-03-04",
      );
      expect(result.fileName).toBe(`${stem}_Delivery-Note_2031-03-04.pdf`);
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.ownerId, po.id), eq(documents.kind, "delivery_note")));
      expect(doc).toMatchObject({
        fileName: `${stem}_Delivery-Note_2031-03-04.pdf`,
        originalName: "Scan 0042.PDF",
      });
    });
  });

  it("appends -2, -3 when another document already has that name", async () => {
    await inRollback(async (tx) => {
      // Two POs of the same vendor, attached on the same day, both with an approval.
      const a = await createPo(tx, {
        vendorName: "Name Clash Trading",
        requestedOn: "2031-03-01",
        lines: [{ description: "Cable", qty: 1, unitPriceAed: 10 }],
      });
      const b = await createPo(tx, {
        vendorName: "name clash trading",
        requestedOn: "2031-03-01",
        lines: [{ description: "Cable", qty: 1, unitPriceAed: 10 }],
      });
      const c = await createPo(tx, {
        vendorName: "Name Clash Trading",
        requestedOn: "2031-03-01",
        lines: [{ description: "Cable", qty: 1, unitPriceAed: 10 }],
      });
      const names: string[] = [];
      for (const po of [a, b, c]) {
        const r = await recordPoDocument(
          tx,
          { poId: po.id, kind: "approval", ...pdf(po.id, "apr.pdf") },
          "2031-03-04",
        );
        names.push(r.fileName);
      }
      expect(names).toEqual([
        "Name-Clash-Trading_Approval_2031-03-04.pdf",
        "Name-Clash-Trading_Approval_2031-03-04-2.pdf",
        "Name-Clash-Trading_Approval_2031-03-04-3.pdf",
      ]);
      // Replacing the first file reuses its own name rather than becoming -4.
      const again = await recordPoDocument(
        tx,
        { poId: a.id, kind: "approval", ...pdf(a.id, "apr2.pdf") },
        "2031-03-04",
      );
      expect(again.fileName).toBe("Name-Clash-Trading_Approval_2031-03-04.pdf");
    });
  });
});

describe("advancePo", () => {
  it("refuses to approve by hand (the approval file does that)", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0158");
      await expect(advancePo(tx, { poId: po.id, to: "approved" })).rejects.toThrow(/approval file/);
    });
  });

  it("moves one stage forward and refuses to skip", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0155"); // approved
      await expect(advancePo(tx, { poId: po.id, to: "delivered" })).rejects.toThrow(
        /isn’t allowed/,
      );
      await advancePo(tx, { poId: po.id, to: "ordered" });
      expect((await poByNumber(tx, "PO-2026-0155")).status).toBe("ordered");
    });
  });
});

describe("updatePo", () => {
  it("edits lines and stage", async () => {
    await inRollback(async (tx) => {
      const po = await poByNumber(tx, "PO-2026-0157");
      const [line] = await tx.select().from(poLines).where(eq(poLines.poId, po.id));
      await updatePo(tx, {
        id: po.id,
        status: "ordered",
        vendorName: "Jumbo Electronics",
        requestedOn: po.requestedOn,
        lines: [
          { id: line!.id, description: line!.description, qty: 10, unitPriceAed: 449 },
          { description: "USB-C hub", qty: 2, unitPriceAed: 199 },
        ],
      });
      expect((await poByNumber(tx, "PO-2026-0157")).status).toBe("ordered");
      const lines = await tx.select().from(poLines).where(eq(poLines.poId, po.id));
      expect(lines.map((l) => l.qty).sort((a, b) => a - b)).toEqual([2, 10]);
    });
  });
});

describe("bulk close (B-16)", () => {
  const setStatus = (tx: Tx, id: string, status: "delivered" | "ordered") =>
    tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, id));

  it("closes delivered purchases together, and undo reopens them", async () => {
    await inRollback(async (tx) => {
      const a = await poByNumber(tx, "PO-2026-0155");
      const b = await poByNumber(tx, "PO-2026-0157");
      await setStatus(tx, a.id, "delivered");
      await setStatus(tx, b.id, "delivered");
      const { poNumbers } = await closeDeliveredPos(tx, { poIds: [a.id, b.id] });
      expect(poNumbers).toEqual(["PO-2026-0155", "PO-2026-0157"]);
      expect((await poByNumber(tx, "PO-2026-0155")).status).toBe("closed");
      await reopenClosedPos(tx, { poIds: [a.id, b.id] });
      await reopenClosedPos(tx, { poIds: [a.id, b.id] });
      expect((await poByNumber(tx, "PO-2026-0157")).status).toBe("delivered");
    });
  });

  it("changes nothing when one is not delivered", async () => {
    await inRollback(async (tx) => {
      const a = await poByNumber(tx, "PO-2026-0155");
      const b = await poByNumber(tx, "PO-2026-0157");
      await setStatus(tx, a.id, "delivered");
      await setStatus(tx, b.id, "ordered");
      await expect(closeDeliveredPos(tx, { poIds: [a.id, b.id] })).rejects.toThrow(/PO-2026-0157/);
      expect((await poByNumber(tx, "PO-2026-0155")).status).toBe("delivered");
    });
  });
});

describe("discount, VAT and invoice date", () => {
  const lines = [
    { description: "Dock", qty: 2, unitPriceAed: 500 },
    { description: "Cable", qty: 1, unitPriceAed: 100.5 },
  ];
  const read = async (tx: Tx, id: string) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    const [sum] = await tx.select().from(poTotals).where(eq(poTotals.poId, id));
    return {
      po: po!,
      money: poTotal({
        subtotal: sum!.totalAed,
        discount: po!.discountAed,
        vat: po!.vatApplied,
      }),
    };
  };

  it("stores the discount and VAT, and the totals follow", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPo(tx, {
        vendorName: "Emitac",
        requestedOn: "2026-10-13",
        discountAed: 100.5,
        vatApplied: true,
        lines,
      });
      const { po, money } = await read(tx, id);
      expect(po).toMatchObject({ discountAed: 100.5, vatApplied: true, invoiceDate: null });
      // 1100.5 - 100.5 = 1000; VAT 50; total 1050
      expect(money).toMatchObject({ subtotal: 1100.5, net: 1000, vat: 50, total: 1050 });

      await updatePo(tx, {
        id,
        vendorName: "Emitac",
        requestedOn: "2026-10-13",
        status: "requested",
        discountAed: 0,
        vatApplied: false,
        lines: (await tx.select().from(poLines).where(eq(poLines.poId, id))).map((l) => ({
          id: l.id,
          description: l.description,
          qty: l.qty,
          unitPriceAed: Number(l.unitPriceAed),
        })),
      });
      expect((await read(tx, id)).money).toMatchObject({ total: 1100.5, vat: 0 });
    });
  });

  it("defaults to no discount and no VAT", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPo(tx, { vendorName: "Emitac", requestedOn: "2026-10-13", lines });
      const { po, money } = await read(tx, id);
      expect(po).toMatchObject({ discountAed: 0, vatApplied: false });
      expect(money.total).toBe(1100.5);
    });
  });

  it("rejects a discount above the subtotal or below zero", async () => {
    await inRollback(async (tx) => {
      const base = { vendorName: "Emitac", requestedOn: "2026-10-13", lines };
      await expect(createPo(tx, { ...base, discountAed: 1100.51 })).rejects.toThrow(/subtotal/);
      await expect(createPo(tx, { ...base, discountAed: -1 })).rejects.toThrow();
    });
  });

  it("an invoice upload saves its date; all three files use it, else their own upload dates", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPo(tx, { vendorName: "Emitac", requestedOn: "2026-10-13", lines });
      // Before any invoice date: the approval keeps its upload date.
      const approval = await recordPoDocument(
        tx,
        { poId: id, kind: "approval", ...pdf(id, "a.pdf") },
        "2026-10-01",
      );
      expect(approval.fileName).toBe("Emitac_Approval_2026-10-01.pdf");

      const invoice = await recordPoDocument(
        tx,
        { poId: id, kind: "invoice", invoiceDate: "2026-09-30", ...pdf(id, "scan.pdf") },
        "2026-10-15",
      );
      expect(invoice.fileName).toBe("Emitac_Invoice_2026-09-30.pdf");
      expect((await read(tx, id)).po.invoiceDate).toBe("2026-09-30");

      // Delivery note uploaded after the invoice follows the invoice date.
      const note = await recordPoDocument(
        tx,
        { poId: id, kind: "delivery_note", ...pdf(id, "dn.pdf") },
        "2026-10-16",
      );
      expect(note.fileName).toBe("Emitac_Delivery-Note_2026-09-30.pdf");

      const name = async (kind: string) => {
        const [d] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.ownerId, id), eq(documents.kind, kind as "invoice")));
        return documentDownloadName(tx, d!.id);
      };
      // The earlier approval is renamed too (names are computed from current data).
      expect(await name("approval")).toBe("Emitac_Approval_2026-09-30.pdf");

      await setInvoiceDate(tx, { poId: id, invoiceDate: "2026-08-01" });
      for (const [kind, label] of [
        ["approval", "Approval"],
        ["invoice", "Invoice"],
        ["delivery_note", "Delivery-Note"],
      ] as const)
        expect(await name(kind)).toBe(`Emitac_${label}_2026-08-01.pdf`);

      // Replacing the invoice with a blank date clears it: files use their upload dates.
      await recordPoDocument(
        tx,
        { poId: id, kind: "invoice", invoiceDate: "", ...pdf(id, "scan2.pdf") },
        "2026-10-17",
      );
      expect((await read(tx, id)).po.invoiceDate).toBeNull();
      expect(await name("invoice")).toMatch(/^Emitac_Invoice_[0-9]{4}-[0-9]{2}-[0-9]{2}[.]pdf$/);
    });
  });

  it("editing a purchase keeps its invoice date", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPo(tx, { vendorName: "Emitac", requestedOn: "2026-10-13", lines });
      await setInvoiceDate(tx, { poId: id, invoiceDate: "2026-09-30" });
      await updatePo(tx, {
        id,
        vendorName: "Emitac",
        requestedOn: "2026-10-13",
        status: "requested",
        lines: (await tx.select().from(poLines).where(eq(poLines.poId, id))).map((l) => ({
          id: l.id,
          description: l.description,
          qty: l.qty,
          unitPriceAed: Number(l.unitPriceAed),
        })),
      });
      expect((await read(tx, id)).po.invoiceDate).toBe("2026-09-30");
    });
  });
});
