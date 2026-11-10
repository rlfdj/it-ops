import { describe, expect, it } from "vitest";
import {
  addedSeatsLabel,
  latestRenewal,
  paidTotals,
  prefillSeats,
  seatCountsLabel,
  type SeatSource,
} from "./subscription-seats";

const renewal = (periodStart: string, standard: number | null, premium: number | null) =>
  ({
    kind: "renewal",
    periodStart,
    seatsStandard: standard,
    seatsPremium: premium,
    tiers: [],
  }) satisfies SeatSource;
const prorated = (periodStart: string, tiers: ("standard" | "premium")[]) =>
  ({
    kind: "prorated",
    periodStart,
    seatsStandard: null,
    seatsPremium: null,
    tiers,
  }) satisfies SeatSource;
const fallback = { standard: 76, premium: 2 };

describe("prefillSeats", () => {
  it("starts from the subscription's own counts when no invoice has counts", () => {
    expect(prefillSeats([], fallback)).toEqual({ standard: 76, premium: 2 });
    expect(prefillSeats([renewal("2026-09-05", null, null)], fallback)).toEqual({
      standard: 76,
      premium: 2,
    });
    expect(prefillSeats([], { standard: null, premium: null })).toEqual({
      standard: 0,
      premium: 0,
    });
  });

  it("is the latest renewal's counts", () => {
    const sources = [renewal("2026-08-05", 70, 1), renewal("2026-09-05", 75, 2)];
    expect(prefillSeats(sources, fallback)).toEqual({ standard: 75, premium: 2 });
  });

  it("adds the seats of pro-rated invoices dated after it", () => {
    const sources = [
      renewal("2026-09-05", 75, 2),
      prorated("2026-09-20", ["premium"]),
      prorated("2026-10-02", ["standard", "standard"]),
      prorated("2026-08-20", ["standard"]), // before the renewal: already in its counts
    ];
    expect(prefillSeats(sources, fallback)).toEqual({ standard: 77, premium: 3 });
  });

  it("looks only at invoices before the one being filled in", () => {
    const sources = [
      renewal("2026-09-05", 75, 2),
      prorated("2026-09-20", ["premium"]),
      renewal("2026-10-05", 77, 3),
    ];
    expect(prefillSeats(sources, fallback, "2026-10-05")).toEqual({ standard: 75, premium: 3 });
    expect(prefillSeats(sources, fallback, "2026-11-05")).toEqual({ standard: 77, premium: 3 });
    expect(prefillSeats(sources, fallback, "2026-09-05")).toEqual({ standard: 76, premium: 2 });
  });
});

describe("labels", () => {
  it("shows the counts compactly", () => {
    expect(seatCountsLabel(76, 2)).toBe("Standard 76 · Premium 2");
    expect(seatCountsLabel(null, 3)).toBe("Standard 0 · Premium 3");
    expect(seatCountsLabel(null, null)).toBeNull();
  });
  it("lists what a pro-rated invoice added", () => {
    expect(addedSeatsLabel(["premium", "standard", "standard"])).toBe("+1 Premium · +2 Standard");
    expect(addedSeatsLabel(["standard"])).toBe("+1 Standard");
    expect(addedSeatsLabel([])).toBe("");
  });
});

describe("paidTotals", () => {
  const today = "2026-10-15";
  it("sums by invoice period or charge date: this month and this year", () => {
    const invoices = [
      { periodStart: "2026-10-05", amountAed: 1000 },
      { periodStart: "2026-10-14", amountAed: 250.5 }, // a pro-rated charge
      { periodStart: "2026-09-05", amountAed: 900 },
      { periodStart: "2026-01-05", amountAed: 100 },
      { periodStart: "2025-10-05", amountAed: 5000 },
    ];
    expect(paidTotals(invoices, today)).toEqual({ month: 1250.5, year: 2250.5 });
  });
  it("skips invoices without an amount and is zero when empty", () => {
    expect(paidTotals([{ periodStart: "2026-10-05", amountAed: null }], today)).toEqual({
      month: 0,
      year: 0,
    });
    expect(paidTotals([], today)).toEqual({ month: 0, year: 0 });
  });
});

describe("latestRenewal", () => {
  it("picks the newest on-file renewal, ignoring pro-rated and unfiled rows", () => {
    const rows = [
      { kind: "renewal" as const, periodStart: "2026-08-05", status: "on_file" },
      { kind: "renewal" as const, periodStart: "2026-09-05", status: "on_file" },
      { kind: "renewal" as const, periodStart: "2026-10-05", status: "missing" },
      { kind: "prorated" as const, periodStart: "2026-10-10", status: "on_file" },
    ];
    expect(latestRenewal(rows)?.periodStart).toBe("2026-09-05");
    expect(latestRenewal([])).toBeNull();
  });
});
