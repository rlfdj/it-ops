import { describe, expect, it } from "vitest";
import { formatPoNumber, parsePoNumber, PO_NUMBER_PATTERN } from "./ids";

describe("PO numbers", () => {
  it("formats PO-YYYY-NNNN", () => {
    expect(formatPoNumber(2026, 158)).toBe("PO-2026-0158");
    expect(formatPoNumber(2027, 1)).toBe("PO-2027-0001");
    expect(PO_NUMBER_PATTERN.test(formatPoNumber(2027, 1))).toBe(true);
  });

  it("rejects sequence numbers that do not fit in four digits", () => {
    expect(() => formatPoNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatPoNumber(2026, 10000)).toThrow(RangeError);
    expect(() => formatPoNumber(2026, 1.5)).toThrow(RangeError);
  });

  it("parses back into scope and sequence", () => {
    expect(parsePoNumber("PO-2026-0158")).toEqual({ scope: "PO-2026", seq: 158 });
    expect(parsePoNumber(formatPoNumber(2027, 42))).toEqual({ scope: "PO-2027", seq: 42 });
  });

  it("returns null for anything else", () => {
    expect(parsePoNumber("PO-26-0001")).toBeNull();
    expect(parsePoNumber("DP-LT-0241")).toBeNull();
  });
});
