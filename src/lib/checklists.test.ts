import { describe, expect, it } from "vitest";
import { itemDueDate, itemState, parentComplete, progress, taskTitle } from "./checklists";
import { buildTemplateItems, STARTING_STEPS } from "./checklist-templates";

const TODAY = "2026-10-13";
const done = new Date("2026-10-12T13:00:00Z");

describe("templates", () => {
  const items = (kind: "onboarding" | "offboarding") =>
    buildTemplateItems(kind, STARTING_STEPS[kind]);

  it("offboarding: collect equipment, then the starting account steps", () => {
    expect(items("offboarding").map((i) => i.label)).toEqual([
      "Collect equipment",
      "Disable email account",
      "Remove from team chat and shared drives",
      "Revoke VPN and remote access",
      "Transfer or archive their files",
    ]);
    expect(items("offboarding")[0]?.equipment).toBe(true);
  });

  it("onboarding: issue equipment, then the starting account steps", () => {
    expect(items("onboarding").map((i) => i.label)).toEqual([
      "Issue equipment",
      "Create email account",
      "Add to team chat and shared drives",
      "Set up VPN and remote access",
    ]);
    expect(
      items("onboarding")
        .slice(1)
        .every((i) => i.section === "accounts"),
    ).toBe(true);
  });

  it("titles tasks with the person's name", () => {
    expect(taskTitle("Revoke VPN access", "Karim Saleh")).toBe("Revoke VPN access — Karim Saleh");
  });
});

describe("sub-items", () => {
  it("completes the parent once every piece is done or not applicable", () => {
    expect(
      parentComplete([
        { doneAt: done, notApplicable: false },
        { doneAt: null, notApplicable: true },
      ]),
    ).toBe(true);
    expect(
      parentComplete([
        { doneAt: done, notApplicable: false },
        { doneAt: null, notApplicable: false },
      ]),
    ).toBe(false);
  });

  it("never auto-completes a parent with no pieces listed", () => {
    expect(parentComplete([])).toBe(false);
  });
});

describe("item state and progress", () => {
  it("shows done, due, overdue and not applicable", () => {
    expect(
      itemState({ doneAt: done, notApplicable: false, dueDate: "2026-10-09" }, TODAY).kind,
    ).toBe("done");
    expect(
      itemState({ doneAt: null, notApplicable: false, dueDate: "2026-10-09" }, TODAY).kind,
    ).toBe("overdue");
    expect(
      itemState({ doneAt: null, notApplicable: false, dueDate: "2026-10-13" }, TODAY).kind,
    ).toBe("due");
    expect(
      itemState({ doneAt: null, notApplicable: true, dueDate: "2026-10-09" }, TODAY).kind,
    ).toBe("na");
  });

  it("counts progress without not-applicable items", () => {
    expect(
      progress(
        [
          { doneAt: done, notApplicable: false, dueDate: "2026-10-09" },
          { doneAt: null, notApplicable: false, dueDate: "2026-10-09" },
          { doneAt: null, notApplicable: false, dueDate: "2026-10-20" },
          { doneAt: null, notApplicable: true, dueDate: null },
        ],
        TODAY,
      ),
    ).toEqual({ done: 1, total: 3, open: 2, overdue: 1 });
  });
});

describe("itemDueDate", () => {
  it("uses the chosen date, else the checklist target (the last day)", () => {
    expect(itemDueDate("2026-10-15", "2026-10-20")).toBe("2026-10-15");
    expect(itemDueDate(null, "2026-10-20")).toBe("2026-10-20");
    expect(itemDueDate(undefined, "2026-10-20")).toBe("2026-10-20");
    expect(itemDueDate("", "2026-10-20")).toBe("2026-10-20");
  });
});
