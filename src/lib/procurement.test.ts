import { describe, expect, it } from "vitest";
import {
  docState,
  docStates,
  lineSummary,
  lineTotal,
  missingDocKinds,
  nextManualStage,
  poTotal,
  stageAfterAttaching,
  docList,
  missingToClose,
} from "./procurement";

describe("required documents per stage", () => {
  it("needs the approval from requested onwards", () => {
    expect(docState("requested", "approval", false)).toBe("miss");
    expect(docState("closed", "approval", false)).toBe("miss");
  });

  it("does not need the invoice until ordered", () => {
    expect(docState("requested", "invoice", false)).toBe("na");
    expect(docState("approved", "invoice", false)).toBe("na");
    expect(docState("ordered", "invoice", false)).toBe("miss");
  });

  it("does not need the delivery note until delivered", () => {
    expect(docState("ordered", "delivery_note", false)).toBe("na");
    expect(docState("delivered", "delivery_note", false)).toBe("miss");
  });

  it("treats an attached document as on file at any stage", () => {
    expect(docState("requested", "invoice", true)).toBe("ok");
  });

  it("lists states in display order: invoice, delivery note, approval", () => {
    expect(docStates("ordered", ["approval"])).toEqual([
      { kind: "invoice", state: "miss" },
      { kind: "delivery_note", state: "na" },
      { kind: "approval", state: "ok" },
    ]);
  });

  it("reports only what is missing", () => {
    expect(missingDocKinds("delivered", ["approval", "invoice"])).toEqual(["delivery_note"]);
    expect(missingDocKinds("approved", ["approval"])).toEqual([]);
  });
});

describe("auto-approval", () => {
  it("moves a requested PO to approved when an approval file is attached", () => {
    expect(stageAfterAttaching("requested", "approval")).toBe("approved");
  });

  it("does nothing for other documents or later stages", () => {
    expect(stageAfterAttaching("requested", "invoice")).toBeNull();
    expect(stageAfterAttaching("ordered", "approval")).toBeNull();
  });
});

describe("manual stage changes", () => {
  it("advances one stage at a time", () => {
    expect(nextManualStage("approved")).toBe("ordered");
    expect(nextManualStage("ordered")).toBe("delivered");
    expect(nextManualStage("delivered")).toBe("closed");
  });

  it("has no manual step out of requested (that needs the approval file) or closed", () => {
    expect(nextManualStage("requested")).toBeNull();
    expect(nextManualStage("closed")).toBeNull();
  });
});

describe("amounts and summaries", () => {
  it("multiplies quantity by unit price, rounded to fils", () => {
    expect(lineTotal({ qty: 3, unitPriceAed: 5995 })).toBe(17985);
    expect(lineTotal({ qty: 3, unitPriceAed: 0.1 })).toBe(0.3);
  });

  it("summarises lines with the text before the first comma", () => {
    expect(
      lineSummary([
        { qty: 1, description: "Synology DS923+ 4-bay NAS" },
        { qty: 4, description: "Synology HAT5300 8 TB drive, enterprise" },
      ]),
    ).toBe("1× Synology DS923+ 4-bay NAS, 4× Synology HAT5300 8 TB drive");
  });
});

describe("closing needs all three documents", () => {
  it("lists what is still missing, in arrival order", () => {
    expect(missingToClose([])).toEqual(["approval", "invoice", "delivery_note"]);
    expect(missingToClose(["approval"])).toEqual(["invoice", "delivery_note"]);
    expect(missingToClose(["delivery_note", "invoice", "approval"])).toEqual([]);
    expect(missingToClose(["approval", "invoice", "other"])).toEqual(["delivery_note"]);
  });
  it("names them in a sentence", () => {
    expect(docList(["delivery_note"])).toBe("the delivery note");
    expect(docList(["invoice", "delivery_note"])).toBe("the invoice and delivery note");
    expect(docList(["approval", "invoice", "delivery_note"])).toBe(
      "the approval, invoice and delivery note",
    );
  });
});

describe("poTotal", () => {
  it("is just the subtotal with no discount or VAT", () => {
    expect(poTotal({ subtotal: 1000 })).toEqual({
      subtotal: 1000,
      discount: 0,
      net: 1000,
      vat: 0,
      total: 1000,
    });
  });
  it("subtracts the discount", () => {
    expect(poTotal({ subtotal: 1000, discount: 150 })).toMatchObject({ net: 850, total: 850 });
  });
  it("adds 5% VAT on the subtotal", () => {
    expect(poTotal({ subtotal: 1000, vat: true })).toMatchObject({ vat: 50, total: 1050 });
  });
  it("takes the discount off first, then applies VAT to what is left", () => {
    expect(poTotal({ subtotal: 1000, discount: 200, vat: true })).toEqual({
      subtotal: 1000,
      discount: 200,
      net: 800,
      vat: 40,
      total: 840,
    });
  });
  it("never goes below zero when the discount is more than the subtotal", () => {
    expect(poTotal({ subtotal: 100, discount: 250, vat: true })).toMatchObject({
      discount: 100,
      net: 0,
      vat: 0,
      total: 0,
    });
  });
  it("rounds VAT half-up to fils", () => {
    expect(poTotal({ subtotal: 0.1, vat: true }).vat).toBe(0.01); // 0.005 -> 0.01
    expect(poTotal({ subtotal: 10.1, vat: true }).vat).toBe(0.51); // 0.505 -> 0.51
    expect(poTotal({ subtotal: 33.33, vat: true })).toMatchObject({ vat: 1.67, total: 35 }); // 1.6665
    expect(poTotal({ subtotal: 19.99, discount: 0.5, vat: true }).vat).toBe(0.97); // 0.9745
  });
  it("treats a missing or null discount as none", () => {
    expect(poTotal({ subtotal: 50, discount: null }).total).toBe(50);
  });
});
