import { describe, expect, it } from "vitest";
import {
  agoLabel,
  dashGroup,
  dueThisMonth,
  expectedTotal,
  inWindow,
  plural,
  rankAttention,
  renewalDue,
} from "./dashboard";

const sub = {
  kind: "subscription" as const,
  billingCycle: "monthly" as const,
  nextChargeDate: "2026-10-19",
  renewalDate: "2027-03-01",
  contractEndDate: "2027-06-30",
};

describe("dashboard", () => {
  it("picks the renewal date by kind and cycle", () => {
    expect(renewalDue(sub)).toBe("2026-10-19");
    expect(renewalDue({ ...sub, billingCycle: "yearly" })).toBe("2027-03-01");
    expect(renewalDue({ ...sub, billingCycle: "yearly", renewalDate: null })).toBe("2026-10-19");
    expect(renewalDue({ ...sub, kind: "contract" })).toBe("2027-06-30");
  });

  it("filters a renewal window, soonest first", () => {
    const items = [{ due: "2026-12-20" }, { due: "2026-10-12" }, { due: "2026-10-18" }];
    expect(inWindow(items, "2026-10-13", 30)).toEqual([{ due: "2026-10-18" }]);
    expect(inWindow(items, "2026-10-13", 90).map((i) => i.due)).toEqual([
      "2026-10-18",
      "2026-12-20",
    ]);
  });

  it("knows this month and task groups", () => {
    expect(dueThisMonth("2026-10-31", "2026-10-13")).toBe(true);
    expect(dueThisMonth("2026-10-12", "2026-10-13")).toBe(false);
    expect(dueThisMonth("2026-11-01", "2026-10-13")).toBe(false);
    expect(dashGroup("2026-10-10", "2026-10-13")).toBe("overdue");
    expect(dashGroup("2026-10-18", "2026-10-13")).toBe("week");
    expect(dashGroup(null, "2026-10-13")).toBe("later");
    expect(plural(1, "task")).toBe("1 task");
    expect(plural(3, "PO")).toBe("3 POs");
  });

  it("ranks needs-attention rows by severity, then age", () => {
    const rows = [
      { id: "a", severity: "amber" as const, ageDays: 40 },
      { id: "b", severity: "red" as const, ageDays: 3 },
      { id: "c", severity: "red" as const, ageDays: 18 },
      { id: "d", severity: "red" as const, ageDays: 18 },
    ];
    expect(rankAttention(rows).map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
    expect(agoLabel(0)).toBe("today");
    expect(agoLabel(1)).toBe("yesterday");
    expect(agoLabel(18)).toBe("18 days ago");
    expect(agoLabel(-2)).toBe("today");
  });
});

describe("expectedTotal", () => {
  it("adds the known costs and leaves the blanks out", () => {
    expect(expectedTotal([{ costAed: 100 }, { costAed: null }, { costAed: 50.5 }])).toBe(150.5);
  });
  it("is null when no renewal has an expected cost, never 0", () => {
    expect(expectedTotal([{ costAed: null }, { costAed: null }])).toBeNull();
    expect(expectedTotal([])).toBeNull();
  });
});
