import { describe, expect, it } from "vitest";
import { isTieredSubscription, seatTotal, tierSummary } from "./seat-tiers";

describe("seatTotal", () => {
  it("adds the tiers, treating one blank tier as 0", () => {
    expect(seatTotal(4, 2)).toBe(6);
    expect(seatTotal(3, null)).toBe(3);
    expect(seatTotal(null, 2)).toBe(2);
  });
  it("is null when both are blank", () => {
    expect(seatTotal(null, null)).toBeNull();
  });
});

describe("tierSummary", () => {
  it("reads like the detail panel", () => {
    expect(tierSummary(4, 2)).toBe("Standard 4 · Premium 2 (6 seats)");
    expect(tierSummary(1, 0)).toBe("Standard 1 · Premium 0 (1 seat)");
    expect(tierSummary(null, null)).toBeNull();
  });
});

describe("isTieredSubscription", () => {
  it("follows the stored flag", () => {
    expect(isTieredSubscription({ tieredSeats: true })).toBe(true);
    expect(isTieredSubscription({ tieredSeats: false })).toBe(false);
    expect(isTieredSubscription({})).toBe(false);
  });
});
