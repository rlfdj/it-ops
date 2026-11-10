import { describe, expect, it } from "vitest";
import {
  formatAed,
  formatAedCompact,
  formatBytes,
  formatMoney,
  formatMoneyCompact,
  formatShortDate,
  moneyText,
  quarterOf,
} from "./format";

describe("formatAed", () => {
  it("uses thousands separators and two decimals", () => {
    expect(formatAed(109115)).toBe("109,115.00");
    expect(formatAed(2203.5)).toBe("2,203.50");
  });

  it("drops decimals for whole amounts in compact form", () => {
    expect(formatAedCompact(6600)).toBe("6,600");
    expect(formatAedCompact(1330.36)).toBe("1,330.36");
  });
});

describe("formatMoney with a base currency", () => {
  it("formats the same for every offered currency and keeps the old names working", () => {
    expect(formatMoney(109115)).toBe("109,115.00");
    expect(formatMoneyCompact(6600)).toBe("6,600");
    expect(formatAed(2203.5)).toBe(formatMoney(2203.5));
  });

  it("puts the workspace currency code in front", () => {
    expect(moneyText("EUR", 1500)).toBe("EUR 1,500.00");
    expect(moneyText("AED", 0.5)).toBe("AED 0.50");
    expect(moneyText("USD", 12)).toBe("USD 12.00");
  });
});

describe("formatShortDate", () => {
  it("omits the year for the current year", () => {
    expect(formatShortDate("2026-10-11", "2026-10-13")).toBe("11 Oct");
    expect(formatShortDate("2026-09-29", "2026-10-13")).toBe("29 Sep");
  });

  it("keeps the year otherwise", () => {
    expect(formatShortDate("2025-01-08", "2026-10-13")).toBe("8 Jan 2025");
  });
});

describe("quarterOf", () => {
  it("finds the calendar quarter and its bounds", () => {
    expect(quarterOf("2026-10-13")).toEqual({
      year: 2026,
      quarter: 4,
      start: "2026-10-01",
      end: "2026-12-31",
    });
    expect(quarterOf("2026-02-28")).toEqual({
      year: 2026,
      quarter: 1,
      start: "2026-01-01",
      end: "2026-03-31",
    });
  });
});

describe("formatBytes", () => {
  it("rounds to a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(214000)).toBe("209 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });
});
