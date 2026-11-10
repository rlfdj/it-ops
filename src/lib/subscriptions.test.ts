import { describe, expect, it } from "vitest";
import {
  addMonths,
  billingLabel,
  decisionTone,
  invoiceStatusFor,
  periodLabel,
  planRollover,
  relativeDays,
  shortPeriodLabel,
  stripDate,
  stripMonths,
  stripPosition,
  layoutStripLane,
  STRIP_LABEL_W,
  urgency,
} from "./subscriptions";

describe("urgency (rule 7)", () => {
  it("is red within 14 days, amber within 30, grey after", () => {
    expect(urgency(0)).toBe("red");
    expect(urgency(14)).toBe("red");
    expect(urgency(15)).toBe("amber");
    expect(urgency(30)).toBe("amber");
    expect(urgency(31)).toBe("grey");
  });

  it("phrases day counts", () => {
    expect(relativeDays(6)).toBe("in 6 days");
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(1)).toBe("tomorrow");
    expect(relativeDays(-3)).toBe("3 days ago");
  });
});

describe("addMonths", () => {
  it("keeps the billing day, clamping short months and recovering after", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonths("2026-12-19", 1)).toBe("2027-01-19");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });
});

describe("labels", () => {
  it("labels periods by month or year", () => {
    expect(periodLabel("monthly", "2026-09-19")).toBe("Sep 2026");
    expect(periodLabel("yearly", "2026-10-24")).toBe("2026");
    expect(shortPeriodLabel("monthly", "2026-09-19")).toBe("Sep ’26");
  });

  it("describes billing", () => {
    expect(billingLabel("monthly", 19, "2026-10-19")).toBe("Monthly, on the 19th");
    expect(billingLabel("monthly", 2, null)).toBe("Monthly, on the 2nd");
    expect(billingLabel("monthly", 11, null)).toBe("Monthly, on the 11th");
    expect(billingLabel("yearly", 24, "2026-10-24")).toBe("Yearly, on 24 Oct");
  });
});

describe("planRollover (ensureInvoicePeriods)", () => {
  const monthly = {
    cycle: "monthly" as const,
    billingDay: 19,
    contractEndDate: null,
    autoRenew: true,
  };

  it("does nothing before the charge date", () => {
    expect(planRollover({ ...monthly, nextChargeDate: "2026-10-19" }, "2026-10-13")).toEqual({
      passed: [],
      upcoming: "2026-10-19",
      nextChargeDate: "2026-10-19",
    });
  });

  it("treats the charge as passed from the next day, and moves the date on", () => {
    expect(planRollover({ ...monthly, nextChargeDate: "2026-10-19" }, "2026-10-19").passed).toEqual(
      [],
    );
    expect(planRollover({ ...monthly, nextChargeDate: "2026-10-19" }, "2026-10-20")).toEqual({
      passed: ["2026-10-19"],
      upcoming: "2026-11-19",
      nextChargeDate: "2026-11-19",
    });
  });

  it("catches up several missed periods (e.g. after the app wasn't opened for a while)", () => {
    expect(planRollover({ ...monthly, nextChargeDate: "2026-08-19" }, "2026-10-20").passed).toEqual(
      ["2026-08-19", "2026-09-19", "2026-10-19"],
    );
  });

  it("rolls yearly plans forward a year", () => {
    expect(
      planRollover(
        { ...monthly, cycle: "yearly", billingDay: 24, nextChargeDate: "2026-10-24" },
        "2026-10-25",
      ),
    ).toMatchObject({ passed: ["2026-10-24"], nextChargeDate: "2027-10-24" });
  });

  it("stops after a contract ends unless it auto-renews", () => {
    const contract = {
      ...monthly,
      billingDay: 15,
      contractEndDate: "2026-11-15",
      autoRenew: false,
    };
    const plan = planRollover({ ...contract, nextChargeDate: "2026-11-15" }, "2026-12-20");
    expect(plan.passed).toEqual(["2026-11-15"]);
    expect(plan.upcoming).toBeNull();
    expect(
      planRollover({ ...contract, autoRenew: true, nextChargeDate: "2026-11-15" }, "2026-12-20")
        .upcoming,
    ).toBe("2027-01-15");
  });
});

describe("invoiceStatusFor", () => {
  it("is on file with a document, missing once the period passed, else upcoming", () => {
    expect(invoiceStatusFor("2026-09-19", true, "2026-10-13")).toBe("on_file");
    expect(invoiceStatusFor("2026-09-19", false, "2026-10-13")).toBe("missing");
    expect(invoiceStatusFor("2026-10-19", false, "2026-10-13")).toBe("upcoming");
    expect(invoiceStatusFor("2026-10-13", false, "2026-10-13")).toBe("upcoming");
  });
});

describe("90-day strip", () => {
  it("places dates proportionally from today", () => {
    expect(stripPosition("2026-10-13", "2026-10-13")).toBe(0);
    expect(stripPosition("2027-01-11", "2026-10-13")).toBe(100);
    expect(stripPosition("2026-11-27", "2026-10-13")).toBe(50);
    expect(stripPosition("2027-06-01", "2026-10-13")).toBe(100);
  });

  it("marks month boundaries (design: November 21.1%, December 54.4%, January 88.9%)", () => {
    expect(stripMonths("2026-10-13").map((m) => [m.label, Number(m.left.toFixed(1))])).toEqual([
      ["November", 21.1],
      ["December", 54.4],
      ["January", 88.9],
    ]);
  });

  it("shows annual renewals and contract ends only", () => {
    expect(
      stripDate({
        kind: "subscription",
        cycle: "yearly",
        renewalDate: "2026-10-24",
        contractEndDate: null,
      }),
    ).toBe("2026-10-24");
    expect(
      stripDate({
        kind: "subscription",
        cycle: "monthly",
        renewalDate: null,
        contractEndDate: null,
      }),
    ).toBeNull();
    expect(
      stripDate({
        kind: "contract",
        cycle: "monthly",
        renewalDate: null,
        contractEndDate: "2026-11-15",
      }),
    ).toBe("2026-11-15");
  });
});

describe("decision tone", () => {
  const base = {
    kind: "subscription" as const,
    billingCycle: "monthly" as const,
    nextChargeDate: "2026-11-01",
    renewalDate: null,
    contractEndDate: null,
    autoRenew: true,
  };
  const today = "2026-10-14";

  it("keeps routine monthly auto-renew charges grey", () => {
    expect(decisionTone({ ...base, nextChargeDate: "2026-10-16" }, today)).toBe("grey");
  });

  it("is red for contract ends and manual renewals, amber at most for auto-renewing annual plans", () => {
    const contract = { ...base, kind: "contract" as const, contractEndDate: "2026-10-20" };
    expect(decisionTone(contract, today)).toBe("red");
    expect(decisionTone({ ...base, autoRenew: false, nextChargeDate: "2026-10-20" }, today)).toBe(
      "red",
    );
    const yearly = { ...base, billingCycle: "yearly" as const, renewalDate: "2026-10-20" };
    expect(decisionTone(yearly, today)).toBe("amber");
    expect(decisionTone({ ...yearly, renewalDate: "2027-03-01" }, today)).toBe("grey");
  });

  it("follows the contract end date", () => {
    const contract = { ...base, kind: "contract" as const, contractEndDate: "2026-12-20" };
    expect(decisionTone(contract, today)).toBe("grey");
    expect(decisionTone({ ...contract, contractEndDate: "2026-11-10" }, today)).toBe("amber");
  });
});

describe("layoutStripLane (B-08 labels)", () => {
  const m = (id: string, pos: number) => ({ id, pos });

  it("labels a lone mark beside its dot, flipped near the right edge", () => {
    expect(layoutStripLane([m("a", 20)])).toEqual([
      { pos: 20, row: 0, flip: false, items: [m("a", 20)] },
    ]);
    expect(layoutStripLane([m("a", 95)])[0]).toMatchObject({ flip: true, row: 0 });
  });

  it("staggers a close pair on two lines", () => {
    const [a, b] = layoutStripLane([m("a", 20), m("b", 24)]);
    expect(new Set([a!.row, b!.row]).size).toBe(2);
    expect(a!.items).toHaveLength(1);
  });

  it("merges marks that sit on top of each other into a count bubble", () => {
    const out = layoutStripLane([m("a", 30), m("b", 30.5), m("c", 31)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to a bubble when two lines are not enough, and never overlaps", () => {
    const items = [10, 13, 16, 19, 22, 25, 28].map((p, i) => m(`s${i}`, p));
    const out = layoutStripLane(items);
    expect(out.reduce((n, e) => n + e.items.length, 0)).toBe(7);
    expect(out.length).toBeLessThan(7);
    for (const row of [0, 1] as const) {
      const labelled = out.filter((e) => e.items.length === 1 && e.row === row);
      for (let i = 1; i < labelled.length; i++)
        expect(labelled[i]!.pos - labelled[i - 1]!.pos).toBeGreaterThanOrEqual(STRIP_LABEL_W);
    }
    // A label never covers another entry's dot.
    for (const e of out.filter((x) => x.items.length === 1 && x.row === 0))
      for (const o of out)
        if (o !== e) expect(o.pos < e.pos - 1 || o.pos > e.pos + STRIP_LABEL_W).toBe(true);
  });

  it("handles an empty lane", () => {
    expect(layoutStripLane([])).toEqual([]);
  });
});
