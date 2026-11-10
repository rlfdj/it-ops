import { describe, expect, it } from "vitest";
import { applyAlertStates, deriveAlerts, type AlertInput } from "./alerts";

const today = "2026-10-14";
const base: AlertInput = { today, renewals: [], overdueTasks: [], pos: [] };

describe("deriveAlerts", () => {
  it("shows renewal costs in the workspace base currency", () => {
    const sub = { id: "s1", name: "Zoom", vendor: "Zoom", kind: "subscription", costAed: 900 };
    const renewals = [{ ...sub, due: "2026-11-05" }];
    expect(deriveAlerts({ ...base, renewals })[0]!.detail).toContain("AED 900");
    expect(deriveAlerts({ ...base, currency: "EUR", renewals })[0]!.detail).toContain("EUR 900");
  });

  it("raises renewals at 30 days and escalates at 14, with a new key per stage", () => {
    const sub = { id: "s1", name: "Zoom", vendor: "Zoom", kind: "subscription", costAed: 900 };
    const at30 = deriveAlerts({ ...base, renewals: [{ ...sub, due: "2026-11-05" }] });
    expect(at30).toHaveLength(1);
    expect(at30[0]).toMatchObject({ tone: "amber", title: "Zoom renews in 22 days" });
    const at14 = deriveAlerts({ ...base, renewals: [{ ...sub, due: "2026-10-20" }] });
    expect(at14[0]).toMatchObject({ tone: "red" });
    expect(at14[0]!.key).not.toBe(at30[0]!.key);
    expect(deriveAlerts({ ...base, renewals: [{ ...sub, due: "2026-12-30" }] })).toEqual([]);
    expect(deriveAlerts({ ...base, renewals: [{ ...sub, due: "2026-10-01" }] })).toEqual([]);
  });

  it("says a contract ends, not renews", () => {
    const [a] = deriveAlerts({
      ...base,
      renewals: [
        {
          id: "c",
          name: "e& line",
          vendor: "e&",
          kind: "contract",
          costAed: 100,
          due: "2026-10-15",
        },
      ],
    });
    expect(a!.title).toBe("e& line ends tomorrow");
  });

  it("raises recently overdue tasks only", () => {
    const keys = deriveAlerts({
      ...base,
      overdueTasks: [
        { id: "a", title: "A", dueDate: "2026-10-13" },
        { id: "b", title: "B", dueDate: "2026-09-01" },
        { id: "c", title: "C", dueDate: "2026-10-14" },
      ],
    }).map((a) => a.key);
    expect(keys).toEqual(["task:a:2026-10-13"]);
  });

  it("chases POs once a document has been missing for more than the threshold", () => {
    const po = { id: "p", poNumber: "PO-1", vendor: "V", missing: ["approval" as const] };
    expect(deriveAlerts({ ...base, pos: [{ ...po, requestedOn: "2026-10-07" }] })).toEqual([]);
    const [a] = deriveAlerts({ ...base, pos: [{ ...po, requestedOn: "2026-10-06" }] });
    expect(a).toMatchObject({ key: "po:p", title: "PO-1 is missing approval" });
    expect(
      deriveAlerts({ ...base, pos: [{ ...po, missing: [], requestedOn: "2026-01-01" }] }),
    ).toEqual([]);
  });

  it("lists red before amber, most urgent first", () => {
    const alerts = deriveAlerts({
      ...base,
      renewals: [
        { id: "r", name: "R", vendor: "v", kind: "subscription", costAed: 1, due: "2026-11-10" },
      ],
      overdueTasks: [{ id: "t", title: "T", dueDate: "2026-10-12" }],
    });
    expect(alerts.map((a) => a.kind)).toEqual(["task", "renewal"]);
  });
});

describe("applyAlertStates", () => {
  it("hides dismissed alerts and marks read ones", () => {
    const alerts = deriveAlerts({
      ...base,
      overdueTasks: [
        { id: "a", title: "A", dueDate: "2026-10-13" },
        { id: "b", title: "B", dueDate: "2026-10-12" },
        { id: "c", title: "C", dueDate: "2026-10-11" },
      ],
    });
    const states = new Map<string, "read" | "dismissed">([
      ["task:a:2026-10-13", "dismissed"],
      ["task:b:2026-10-12", "read"],
    ]);
    const out = applyAlertStates(alerts, states);
    expect(out.map((a) => [a.key, a.read])).toEqual([
      ["task:c:2026-10-11", false],
      ["task:b:2026-10-12", true],
    ]);
  });
});

describe("deriveAlerts for renewals", () => {
  const zoom = {
    id: "z",
    name: "Zoom Workplace Pro",
    vendor: "Zoom",
    kind: "subscription",
    costAed: 900 as number | null,
    due: "2026-11-05",
  };
  const run = (renewal: Partial<typeof zoom>) =>
    deriveAlerts({ ...base, renewals: [{ ...zoom, ...renewal }] });

  it("alerts on the renewal date, 30 and 14 days out", () => {
    const [a] = run({});
    expect(a).toMatchObject({
      key: "renewal:z:2026-11-05:30",
      tone: "amber",
      title: "Zoom Workplace Pro renews in 22 days",
      href: "/subscriptions?sub=z",
    });
    expect(run({ due: "2026-10-20" })[0]).toMatchObject({
      tone: "red",
      key: "renewal:z:2026-10-20:14",
    });
    expect(run({ due: "2026-12-30" })).toEqual([]);
  });

  it("says a contract ends", () => {
    expect(run({ kind: "contract", due: "2026-10-20" })[0]!.title).toContain("ends in 6 days");
  });

  it("shows the expected cost, or says there is none", () => {
    expect(run({})[0]!.detail).toContain("AED 900");
    expect(run({ costAed: null })[0]!.detail).toContain("no expected cost");
    expect(run({ costAed: null })[0]!.detail).not.toContain("AED 0");
  });
});
