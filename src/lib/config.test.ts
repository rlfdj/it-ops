import { describe, expect, it } from "vitest";
import { billingCurrency, toAed, USD_AED } from "./config";

describe("toAed", () => {
  it("uses the fixed 3.6725 USD rate", () => {
    expect(USD_AED).toBe(3.6725);
    expect(toAed(600, "USD")).toBe(2203.5);
    expect(toAed(362.25, "USD")).toBe(1330.36);
  });

  it("uses the workspace rate when one is given", () => {
    expect(toAed(100, "USD", 3.7)).toBe(370);
  });

  it("leaves AED untouched", () => {
    expect(toAed(31248, "AED")).toBe(31248);
  });

  it("refuses currencies without a configured rate", () => {
    expect(() => toAed(10, "EUR")).toThrow();
  });

  it("converts to another base currency", () => {
    expect(toAed(100, "USD", 0.92, "EUR")).toBe(92);
    expect(toAed(100, "EUR", 0.92, "EUR")).toBe(100);
    expect(() => toAed(100, "AED", 0.92, "EUR")).toThrow();
  });

  it("needs no rate when USD is the base", () => {
    expect(toAed(100, "USD", 3.6725, "USD")).toBe(100);
  });

  it("treats a row from an earlier base currency as already in the base", () => {
    expect(billingCurrency("AED", "EUR")).toBe("EUR");
    expect(billingCurrency("USD", "EUR")).toBe("USD");
    expect(billingCurrency("EUR", "EUR")).toBe("EUR");
  });
});
