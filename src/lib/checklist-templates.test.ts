import { describe, expect, it } from "vitest";
import {
  MAX_STEP_LABEL,
  MAX_TEMPLATE_STEPS,
  STARTING_STEPS,
  buildTemplateItems,
  cleanSteps,
  parseStoredSteps,
  stepsOrDefault,
  validateSteps,
} from "./checklist-templates";

describe("parseStoredSteps", () => {
  it("reads labels and details, trimming them", () => {
    expect(
      parseStoredSteps([{ label: "  Disable email " }, { label: "Wipe laptop", detail: " now " }]),
    ).toEqual([{ label: "Disable email" }, { label: "Wipe laptop", detail: "now" }]);
  });
  it("drops malformed entries and gives null when nothing is left", () => {
    expect(parseStoredSteps([null, 3, { label: "" }, { detail: "x" }, { label: "Ok" }])).toEqual([
      { label: "Ok" },
    ]);
    expect(parseStoredSteps([])).toBeNull();
    expect(parseStoredSteps(null)).toBeNull();
    expect(parseStoredSteps("nope")).toBeNull();
  });
  it("caps the number of steps", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ label: `Step ${i}` }));
    expect(parseStoredSteps(many)).toHaveLength(MAX_TEMPLATE_STEPS);
  });
});

describe("stepsOrDefault", () => {
  it("falls back to the starting steps when nothing usable is saved", () => {
    expect(stepsOrDefault("offboarding", null)).toBe(STARTING_STEPS.offboarding);
    expect(stepsOrDefault("onboarding", [])).toBe(STARTING_STEPS.onboarding);
  });
  it("uses the saved steps", () => {
    expect(stepsOrDefault("onboarding", [{ label: "Only this" }])).toEqual([
      { label: "Only this" },
    ]);
  });
});

describe("validateSteps", () => {
  it("accepts a normal list, and an empty one", () => {
    expect(validateSteps([{ label: "A" }, { label: "B" }])).toBeNull();
    expect(validateSteps([])).toBeNull();
  });
  it("needs a name on every step", () => {
    expect(validateSteps([{ label: "A" }, { label: "  " }])).toBe("Step 2 needs a name.");
  });
  it("limits the length and the number of steps", () => {
    expect(validateSteps([{ label: "x".repeat(MAX_STEP_LABEL + 1) }])).toMatch(/too long/);
    expect(validateSteps([{ label: "x".repeat(MAX_STEP_LABEL) }])).toBeNull();
    const many = Array.from({ length: MAX_TEMPLATE_STEPS + 1 }, () => ({ label: "A" }));
    expect(validateSteps(many)).toMatch(/at most 40/);
  });
});

describe("cleanSteps", () => {
  it("trims and drops empty details", () => {
    expect(
      cleanSteps([
        { label: " A ", detail: "  " },
        { label: "B", detail: " d " },
      ]),
    ).toEqual([{ label: "A" }, { label: "B", detail: "d" }]);
  });
});

describe("buildTemplateItems", () => {
  it("puts the built-in equipment step first, then the steps as account items in order", () => {
    const items = buildTemplateItems("offboarding", [
      { label: "Disable email" },
      { label: "Archive files", detail: "To the shared drive" },
    ]);
    expect(items.map((i) => i.label)).toEqual([
      "Collect equipment",
      "Disable email",
      "Archive files",
    ]);
    expect(items[0]).toMatchObject({ section: "assets", equipment: true });
    expect(items[1]).toEqual({ section: "accounts", label: "Disable email" });
    expect(items[2]).toMatchObject({ section: "accounts", detail: "To the shared drive" });
  });
  it("uses the onboarding equipment wording, and still works with no saved steps", () => {
    expect(buildTemplateItems("onboarding", []).map((i) => i.label)).toEqual(["Issue equipment"]);
  });
});
