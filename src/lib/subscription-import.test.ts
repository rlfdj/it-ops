import { describe, expect, it } from "vitest";
import { parseSubscriptionCsv, toSubscriptionInput } from "./subscription-import";

describe("parseSubscriptionCsv", () => {
  it("maps the export's columns and fills the defaults", () => {
    const r = parseSubscriptionCsv(
      "Name,Vendor,Expected cost,Next charge,Kind,Billing,Notice (days),Auto-renew\nZoom,Zoom Inc,45,2026-11-05,Contract,Yearly,30,No\nSlack,Slack,,2026-11-01,,,,\n",
    );
    expect("rows" in r && r.rows).toHaveLength(2);
    if (!("rows" in r)) return;
    expect(r.rows[0]).toMatchObject({
      kind: "contract",
      billingCycle: "yearly",
      autoRenew: "no",
    });
    expect(r.rows[1]).toMatchObject({
      kind: "subscription",
      billingCycle: "monthly",
      currency: "",
      autoRenew: "yes",
      active: "yes",
    });
    expect(toSubscriptionInput(r.rows[0]!)).toMatchObject({ autoRenew: false, active: true });
    // A blank currency means the workspace base currency.
    expect(toSubscriptionInput(r.rows[1]!).currency).toBe("AED");
    expect(toSubscriptionInput(r.rows[1]!, "EUR").currency).toBe("EUR");
  });

  it("keeps the expected cost optional", () => {
    const r = parseSubscriptionCsv("Name,Vendor,Next charge\nSlack,Slack,2026-11-01\n");
    expect("rows" in r && r.rows[0]).toMatchObject({ costOriginal: "" });
  });

  it("needs the name, vendor and next charge columns", () => {
    expect(parseSubscriptionCsv("Name,Vendor\nA,B\n")).toEqual({
      error: "The first row must be a header. Missing column: Next charge.",
    });
    expect(parseSubscriptionCsv("")).toEqual({ error: "The file is empty." });
  });
});
