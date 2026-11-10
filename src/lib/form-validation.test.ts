import { describe, expect, it } from "vitest";
import {
  checkMoney,
  checkQty,
  hasErrors,
  parseDecimal,
  validatePo,
  validateStockRows,
  validateInvoice,
  validateSub,
  validateTask,
} from "./form-validation";

describe("parseDecimal", () => {
  it("accepts plain decimals only", () => {
    expect(parseDecimal("1200.50")).toBe(1200.5);
    expect(parseDecimal(" 3 ")).toBe(3);
    expect(parseDecimal("1,200")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });
});

describe("checkQty / checkMoney", () => {
  it("wants a whole number from 1", () => {
    expect(checkQty("2")).toBeNull();
    expect(checkQty("")).toMatch(/quantity/i);
    expect(checkQty("1.5")).toMatch(/whole number/);
    expect(checkQty("0")).toMatch(/at least 1/);
  });
  it("wants a non-negative number", () => {
    expect(checkMoney("0", "the cost")).toBeNull();
    expect(checkMoney("12.5", "the cost")).toBeNull();
    expect(checkMoney("-1", "the cost")).toMatch(/negative/);
    expect(checkMoney("x", "the cost")).toMatch(/number/);
    expect(checkMoney("", "the cost")).toBe("Enter the cost.");
  });
});

describe("validatePo", () => {
  const ok = {
    vendorName: "Dell",
    requestedOn: "2026-10-12",
    lines: [{ key: "a", description: "Laptop", qty: "2", unitPriceAed: "4500" }],
  };
  it("passes a good form", () => expect(hasErrors(validatePo(ok))).toBe(false));
  it("names each bad field", () => {
    const errors = validatePo({
      vendorName: " ",
      requestedOn: "",
      lines: [{ key: "a", description: "", qty: "0", unitPriceAed: "" }],
    });
    expect(Object.keys(errors).sort()).toEqual([
      "date",
      "line:a:description",
      "line:a:price",
      "line:a:qty",
      "vendor",
    ]);
  });
});

describe("validateSub", () => {
  const base = {
    name: "Slack",
    vendorName: "Slack",
    kind: "subscription" as const,
    seats: "",
    costOriginal: "80",
    nextChargeDate: "2026-11-01",
    contractEndDate: "",
  };
  it("accepts a subscription without an end date", () =>
    expect(hasErrors(validateSub(base))).toBe(false));
  it("requires an end date for contracts", () =>
    expect(validateSub({ ...base, kind: "contract" }).contractEndDate).toBe(
      "Contracts need an end date.",
    ));
});

describe("validateStockRows", () => {
  it("flags blanks and repeated tags", () => {
    const errors = validateStockRows([
      { key: "1", tag: "DP-1", model: "Mac" },
      { key: "2", tag: "dp-1", model: "" },
      { key: "3", tag: "", model: "Mac" },
    ]);
    expect(errors["2:tag"]).toMatch(/twice/);
    expect(errors["2:model"]).toBeDefined();
    expect(errors["3:tag"]).toBeDefined();
    expect(errors["1:tag"]).toBeUndefined();
  });
});

describe("validateTask", () => {
  it("needs a title", () => expect(validateTask({ title: " ", dueDate: "" }).title).toBeDefined());
  it("rejects a malformed date", () =>
    expect(validateTask({ title: "x", dueDate: "13/10/2026" }).dueDate).toBeDefined());
});

describe("validateInvoice", () => {
  it("always needs the amount", () => {
    expect(validateInvoice({ amount: "" }).amount).toBe("Enter the amount.");
    expect(validateInvoice({ amount: "12.50" })).toEqual({});
  });
  it("needs whole seat counts for a tiered renewal invoice", () => {
    expect(validateInvoice({ amount: "1", counts: { standard: "76", premium: "2" } })).toEqual({});
    const bad = validateInvoice({ amount: "1", counts: { standard: "", premium: "1.5" } });
    expect(bad.seatsStandard).toBeTruthy();
    expect(bad.seatsPremium).toBeTruthy();
  });
  it("needs at least one seat, each with a person, for a pro-rated invoice", () => {
    expect(validateInvoice({ amount: "1", seats: [] }).seats).toBe("Add at least one seat.");
    const errors = validateInvoice({
      amount: "1",
      seats: [
        { key: "a", personName: "Sara" },
        { key: "b", personName: " " },
      ],
    });
    expect(errors["seat:b:person"]).toBe("Enter the person.");
    expect(errors["seat:a:person"]).toBeUndefined();
  });
});
