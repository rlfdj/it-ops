import { describe, expect, it } from "vitest";
import { formatDateInput, monthGrid, parseDateInput } from "./date-input";

describe("parseDateInput", () => {
  it("reads the app format, ISO and day-first numeric dates", () => {
    expect(parseDateInput("13 Oct 2026")).toBe("2026-10-13");
    expect(parseDateInput("13 october 2026")).toBe("2026-10-13");
    expect(parseDateInput("3 Sept 2026")).toBe("2026-09-03");
    expect(parseDateInput("2026-10-13")).toBe("2026-10-13");
    expect(parseDateInput("13/10/2026")).toBe("2026-10-13");
    expect(parseDateInput("01/02/2026")).toBe("2026-02-01");
  });

  it("rejects things that are not real dates", () => {
    for (const bad of ["", "31 Feb 2026", "13 Foo 2026", "2026-13-01", "13/10", "tomorrow"]) {
      expect(parseDateInput(bad)).toBeNull();
    }
  });
});

describe("date field helpers", () => {
  it("formats a value for display", () => {
    expect(formatDateInput("2026-10-08")).toBe("8 Oct 2026");
    expect(formatDateInput("")).toBe("");
  });

  it("builds six Monday-first weeks", () => {
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(6);
    expect(grid[0]![0]!.date).toBe("2026-09-28");
    expect(grid[0]![3]).toEqual({ date: "2026-10-01", inMonth: true });
  });
});
