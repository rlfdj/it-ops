import { describe, expect, it } from "vitest";
import {
  filterSeats,
  rosterCounts,
  rosterMismatchNote,
  seatItemLabel,
  seatsForInvoice,
  seatSummary,
} from "./seat-roster";

const seat = (tier: "standard" | "premium", since: string, until: string | null = null) => ({
  tier,
  since,
  until,
});
const roster = [
  seat("standard", "2026-01-01"),
  seat("standard", "2026-01-01"),
  seat("premium", "2026-03-01"),
  seat("standard", "2026-01-01", "2026-06-01"), // ended
];

describe("rosterCounts", () => {
  it("counts the active seats by tier", () => {
    expect(rosterCounts(roster)).toEqual({ standard: 2, premium: 1 });
  });
  it("counts the seats held on a date, ended seats included before their end", () => {
    expect(rosterCounts(roster, "2026-02-01")).toEqual({ standard: 3, premium: 0 });
    expect(rosterCounts(roster, "2026-06-01")).toEqual({ standard: 2, premium: 1 });
  });
});

describe("seatsForInvoice", () => {
  it("uses the roster when it holds seats on that date, else the fallback rule", () => {
    const fallback = () => ({ standard: 76, premium: 2 });
    expect(seatsForInvoice(roster, "2026-10-01", fallback)).toEqual({ standard: 2, premium: 1 });
    expect(seatsForInvoice([], "2026-10-01", fallback)).toEqual({ standard: 76, premium: 2 });
    expect(seatsForInvoice(roster, "2025-01-01", fallback)).toEqual({ standard: 76, premium: 2 });
  });
});

describe("rosterMismatchNote", () => {
  const big = [
    ...Array.from({ length: 77 }, () => seat("standard", "2026-01-01")),
    ...Array.from({ length: 2 }, () => seat("premium", "2026-01-01")),
  ];
  it("names the tier that differs", () => {
    expect(rosterMismatchNote(big, "2026-10-01", { standard: 76, premium: 2 })).toBe(
      "Roster has 77 Standard; invoice says 76.",
    );
    expect(rosterMismatchNote(big, "2026-10-01", { standard: 77, premium: 3 })).toBe(
      "Roster has 2 Premium; invoice says 3.",
    );
  });
  it("names both tiers when both differ", () => {
    expect(rosterMismatchNote(big, "2026-10-01", { standard: 76, premium: 3 })).toBe(
      "Roster has 77 Standard and 2 Premium; invoice says 76 and 3.",
    );
  });
  it("is silent when the counts agree or the roster is empty", () => {
    expect(rosterMismatchNote(big, "2026-10-01", { standard: 77, premium: 2 })).toBeNull();
    expect(rosterMismatchNote([], "2026-10-01", { standard: 5, premium: 1 })).toBeNull();
  });
});

describe("labels and filter", () => {
  it("labels the offboarding item and the person's seat", () => {
    expect(seatItemLabel("Claude Code Team", "premium")).toBe(
      "Remove Claude Code Team seat (Premium)",
    );
    expect(
      seatSummary({ subscriptionName: "Claude Code Team", tier: "premium", project: "Bidding" }),
    ).toBe("Claude Code Team · Premium · Bidding");
    expect(
      seatSummary({ subscriptionName: "ChatGPT Business", tier: "standard", project: null }),
    ).toBe("ChatGPT Business · Standard");
  });
  it("filters by name or project, any case", () => {
    const rows = [
      { personName: "sara@x.com", project: "Bidding" },
      { personName: "Omar", project: null },
    ];
    expect(filterSeats(rows, "BID")).toHaveLength(1);
    expect(filterSeats(rows, "omar")).toHaveLength(1);
    expect(filterSeats(rows, "  ")).toHaveLength(2);
  });
});
