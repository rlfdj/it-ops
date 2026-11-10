// Closing a purchase needs the approval, invoice and delivery note (owner rule), on every
// route: the Close button (advancePo), bulk close and the status field in Edit (updatePo).
// Self-contained: each test makes its own purchase inside a rolled-back transaction.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { inRollback } from "../test/db.ts";
import type { Tx } from "../db/actor.ts";
import { documents, purchaseOrders } from "../db/schema.ts";
import { advancePo, closeDeliveredPos, createPo, updatePo } from "./procurement.ts";

const LINES = [{ description: "E2E close-guard cable", qty: 1, unitPriceAed: 10 }];

async function deliveredPo(tx: Tx, kinds: ("approval" | "invoice" | "delivery_note")[]) {
  const po = await createPo(tx, {
    vendorName: "E2E Close Guard Vendor",
    requestedOn: "2026-10-01",
    lines: LINES,
  });
  await tx.update(purchaseOrders).set({ status: "delivered" }).where(eq(purchaseOrders.id, po.id));
  for (const kind of kinds) {
    await tx.insert(documents).values({
      ownerType: "purchase_order",
      ownerId: po.id,
      kind,
      storagePath: `e2e-close-guard/${po.id}/${kind}.pdf`,
      fileName: `${kind}.pdf`,
      sizeBytes: 1,
    });
  }
  return po;
}

const statusOf = async (tx: Tx, id: string) =>
  (
    await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
  )[0]?.status;

describe("closing a purchase needs all three documents", () => {
  it("refuses the Close button while a document is missing, naming it", () =>
    inRollback(async (tx) => {
      const po = await deliveredPo(tx, ["approval", "invoice"]);
      await expect(advancePo(tx, { poId: po.id, to: "closed" })).rejects.toThrow(
        "Upload the delivery note before closing this purchase.",
      );
      expect(await statusOf(tx, po.id)).toBe("delivered");
    }));

  it("closes once the approval, invoice and delivery note are attached", () =>
    inRollback(async (tx) => {
      const po = await deliveredPo(tx, ["approval", "invoice", "delivery_note"]);
      await advancePo(tx, { poId: po.id, to: "closed" });
      expect(await statusOf(tx, po.id)).toBe("closed");
    }));

  it("bulk close changes nothing when any purchase is missing documents", () =>
    inRollback(async (tx) => {
      const ready = await deliveredPo(tx, ["approval", "invoice", "delivery_note"]);
      const short = await deliveredPo(tx, ["approval"]);
      await expect(closeDeliveredPos(tx, { poIds: [ready.id, short.id] })).rejects.toThrow(
        `${short.poNumber} (invoice, delivery note)`,
      );
      expect(await statusOf(tx, ready.id)).toBe("delivered");
      expect(await statusOf(tx, short.id)).toBe("delivered");
    }));

  it("refuses setting Closed in the Edit dialog without the documents", () =>
    inRollback(async (tx) => {
      const po = await deliveredPo(tx, []);
      await expect(
        updatePo(tx, {
          id: po.id,
          vendorName: "E2E Close Guard Vendor",
          requestedOn: "2026-10-01",
          status: "closed",
          lines: LINES,
        }),
      ).rejects.toThrow("Upload the approval, invoice and delivery note before closing");
      expect(await statusOf(tx, po.id)).toBe("delivered");
    }));
});
