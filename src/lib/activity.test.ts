import { describe, expect, it } from "vitest";
import {
  actorName,
  dayLabel,
  describe as sentence,
  dubaiParts,
  timeParts,
  fieldLabel,
  formatValue,
  primaryChange,
  sentenceText,
  type LogEntry,
} from "./activity";

const links = {
  po: (n: string) => `/procurement?po=${n}`,
  subscription: (id: string) => `/subscriptions?sub=${id}`,
  checklist: (id: string) => `/onboarding?checklist=${id}`,
  person: (id: string) => `/onboarding?person=${id}`,
};

const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: 1,
  at: new Date("2026-10-13T06:42:00Z"),
  actor: "alex@example.com",
  action: "update",
  tableName: "purchase_orders",
  recordId: "00000000-0000-0000-0000-000000000001",
  recordLabel: "PO-2026-0155",
  module: "Procurement",
  changes: {},
  ...over,
});

describe("values and fields", () => {
  it("humanises fields and values", () => {
    expect(fieldLabel("next_charge_date")).toBe("Next charge");
    expect(fieldLabel("plan")).toBe("Plan");
    expect(formatValue("in_progress")).toBe("In progress");
    expect(formatValue("approved")).toBe("Approved");
    expect(formatValue("assigned")).toBe("Assigned");
    expect(formatValue("2026-10-19")).toBe("19 Oct 2026");
    expect(formatValue("2026-10-12T13:05:00.000Z")).toBe("12 Oct 2026");
    expect(formatValue(null)).toBe("—");
    expect(formatValue(true)).toBe("Yes");
    expect(formatValue(42)).toBe("42");
    expect(formatValue("0b0f6f0e-1b2c-4c3d-9e8f-123456789abc")).toBe("(linked record)");
  });

  it("shows the status change first", () => {
    expect(
      primaryChange({
        notes: { old: null, new: "x" },
        status: { old: "requested", new: "approved" },
      }),
    ).toEqual({ field: "Status", from: "Requested", to: "Approved" });
  });
});

describe("sentences", () => {
  it("POs: created, moved, updated", () => {
    const moved = sentence(
      entry({ changes: { status: { old: "requested", new: "approved" } } }),
      links,
    );
    expect(moved).toMatchObject({
      verb: "Moved",
      rest: "to Approved",
      ref: { label: "PO-2026-0155", mono: true },
    });
    expect(moved.change).toEqual({ field: "Status", from: "Requested", to: "Approved" });
    expect(sentence(entry({ action: "insert" }), links).verb).toBe("Created");
  });

  it("documents link to their PO", () => {
    const s = sentence(
      entry({
        action: "insert",
        tableName: "documents",
        recordLabel: "APR-MW-0155.pdf",
        changes: { kind: { old: null, new: "approval" } },
        context: { poNumber: "PO-2026-0155" },
      }),
      links,
    );
    expect(sentenceText(s)).toBe("Attached approval file APR-MW-0155.pdf to PO-2026-0155");
    expect(s.ref?.href).toBe("/procurement?po=PO-2026-0155");
  });

  it("checklist items: ticked on the person's checklist", () => {
    const s = sentence(
      entry({
        tableName: "checklist_items",
        module: "People",
        recordLabel: "Deactivate Jira account",
        changes: { done_at: { old: null, new: "2026-10-12T13:20:00Z" } },
        context: { checklistId: "c1", personName: "Karim Saleh", checklistKind: "offboarding" },
      }),
      links,
    );
    expect(sentenceText(s)).toBe("Ticked “Deactivate Jira account” on Karim Saleh offboarding");
    expect(s.item).toBe("Deactivate Jira account");
    expect(s.ref?.href).toBe("/onboarding?checklist=c1");
    const orphan = sentence(
      entry({
        tableName: "checklist_items",
        recordLabel: "Disable Slack",
        changes: { done_at: { old: null, new: "2026-10-12T13:20:00Z" } },
      }),
      links,
    );
    expect(sentenceText(orphan)).toBe("Ticked “Disable Slack”");
  });

  it("subscription invoices: filed and missing", () => {
    const base = entry({
      tableName: "subscription_invoices",
      module: "Subscriptions",
      recordLabel: "Jira Software Cloud · Sep 2026",
      context: { subscriptionId: "s1", subscriptionName: "Jira Software Cloud" },
    });
    expect(
      sentenceText(
        sentence({ ...base, changes: { status: { old: "missing", new: "on_file" } } }, links),
      ),
    ).toBe("Filed the Sep 2026 invoice for Jira Software Cloud");
    expect(
      sentence({ ...base, changes: { status: { old: "upcoming", new: "missing" } } }, links).verb,
    ).toBe("Flagged the Sep 2026 invoice as missing for");
  });

  it("checklist templates: says which template was edited, no JSON", () => {
    const s = sentence(
      entry({
        tableName: "checklist_templates",
        module: "People",
        recordLabel: "offboarding",
        changes: { steps: { old: [{ label: "a" }], new: [{ label: "a" }, { label: "b" }] } },
      }),
      links,
    );
    expect(sentenceText(s)).toBe("Updated the offboarding template");
    expect(s.change).toBeNull();
    expect(
      sentenceText(
        sentence(entry({ tableName: "checklist_templates", recordLabel: "onboarding" }), links),
      ),
    ).toBe("Updated the onboarding template");
  });

  it("subscriptions: billing roll-over and edits", () => {
    const base = entry({
      tableName: "subscriptions",
      module: "Subscriptions",
      recordLabel: "Claude Team",
    });
    expect(
      sentence(
        { ...base, changes: { next_charge_date: { old: "2026-10-19", new: "2026-11-19" } } },
        links,
      ).verb,
    ).toBe("Rolled");
    const edit = sentence({ ...base, changes: { seats: { old: 40, new: 42 } } }, links);
    expect(edit.change).toEqual({ field: "Seats", from: "40", to: "42" });
  });

  it("tasks and legacy rows", () => {
    expect(
      sentence(
        entry({
          tableName: "tasks",
          recordLabel: "Order toner",
          changes: { status: { old: "open", new: "done" } },
        }),
        links,
      ).verb,
    ).toBe("Completed task");
    const notesOnly = sentence(
      entry({
        tableName: "tasks",
        recordLabel: "Order toner",
        changes: { notes: { old: "", new: "Ask Dell about the long note text" } },
      }),
      links,
    );
    expect(notesOnly).toMatchObject({ verb: "Updated the notes on task", change: null });
    const legacy = sentence(entry({ tableName: "assets", recordLabel: "DP-LT-0236" }), links);
    expect(legacy).toMatchObject({
      verb: "Updated",
      ref: { label: "DP-LT-0236", href: null, mono: true },
    });
  });
});

describe("time and actors", () => {
  it("uses Dubai time and day labels", () => {
    expect(dubaiParts(new Date("2026-10-13T06:42:00Z"))).toEqual({
      date: "2026-10-13",
      time: "10:42",
    });
    expect(dubaiParts(new Date("2026-10-12T21:30:00Z")).date).toBe("2026-10-13");
    expect(dayLabel("2026-10-13", "2026-10-13")).toBe("Today · Tue 13 Oct");
    expect(dayLabel("2026-10-09", "2026-10-13")).toBe("Fri 9 Oct");
    expect(dayLabel("2025-12-31", "2026-10-13")).toBe("Wed 31 Dec 2025");
  });

  it("follows the workspace time zone", () => {
    const at = new Date("2026-10-12T21:30:00Z");
    expect(timeParts(at, "Asia/Dubai")).toEqual({ date: "2026-10-13", time: "01:30" });
    expect(timeParts(at, "America/New_York")).toEqual({ date: "2026-10-12", time: "17:30" });
    expect(timeParts(at, "UTC").time).toBe("21:30");
    expect(timeParts(at)).toEqual(dubaiParts(at));
  });

  it("names actors", () => {
    expect(actorName("alex@example.com")).toBe("Alex");
    expect(actorName("system")).toBe("System");
  });
});

describe("board notes", () => {
  const note = (over: Partial<LogEntry>) =>
    entry({ tableName: "notes", module: "Board", recordLabel: "Call Dell", ...over });
  const text = (e: LogEntry) => sentenceText(sentence(e, links));

  it("describes creating, editing, deleting and restoring a note", () => {
    expect(text(note({ action: "insert" }))).toBe("Added note Call Dell");
    expect(text(note({ changes: { text: { old: "a", new: "ab" } } }))).toBe(
      "Edited note Call Dell",
    );
    const gone = { deleted_at: { old: null, new: "2026-10-14T08:00:00Z" } };
    expect(text(note({ changes: gone }))).toBe("Deleted note Call Dell");
    const back = { deleted_at: { old: "2026-10-14T08:00:00Z", new: null } };
    expect(text(note({ changes: back }))).toBe("Restored note Call Dell");
  });

  it("says when a note was made into a task, and shows a colour change", () => {
    expect(text(note({ changes: { made_task_id: { old: null, new: "x" } } }))).toBe(
      "Made a task from note Call Dell",
    );
    const colour = { colour: { old: "yellow", new: "pink" } };
    expect(sentence(note({ changes: colour }), links).change).toEqual({
      field: "Colour",
      from: "Yellow",
      to: "Pink",
    });
  });

  it("describes files attached to a note", () => {
    const doc = (action: "insert" | "delete") =>
      entry({
        tableName: "documents",
        module: "Board",
        action,
        recordLabel: "screenshot.png",
        changes: {
          owner_type: action === "insert" ? { old: null, new: "note" } : { old: "note", new: null },
        },
      });
    expect(text(doc("insert"))).toBe("Attached file screenshot.png to a note");
    expect(text(doc("delete"))).toBe("Removed file screenshot.png from a note");
  });
});
