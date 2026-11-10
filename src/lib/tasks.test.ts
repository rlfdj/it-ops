import { describe, expect, it } from "vitest";
import {
  dueGroup,
  endOfWeek,
  formatDue,
  isOverdue,
  parseDueWord,
  parseQuickAdd,
  sourceShortLabel,
} from "./tasks";

// Tue 13 Oct 2026, as in the designs.
const TODAY = "2026-10-13";

describe("parseDueWord", () => {
  it("understands today, tomorrow and weekdays", () => {
    expect(parseDueWord("today", TODAY)).toBe("2026-10-13");
    expect(parseDueWord("tomorrow", TODAY)).toBe("2026-10-14");
    expect(parseDueWord("tmr", TODAY)).toBe("2026-10-14");
    expect(parseDueWord("fri", TODAY)).toBe("2026-10-16");
    expect(parseDueWord("friday", TODAY)).toBe("2026-10-16");
    expect(parseDueWord("mon", TODAY)).toBe("2026-10-19");
  });

  it("means next week for today's weekday", () => {
    expect(parseDueWord("tue", TODAY)).toBe("2026-10-20");
  });

  it("understands day + month and ISO dates, rolling past dates into next year", () => {
    expect(parseDueWord("20oct", TODAY)).toBe("2026-10-20");
    expect(parseDueWord("20-oct", TODAY)).toBe("2026-10-20");
    expect(parseDueWord("oct20", TODAY)).toBe("2026-10-20");
    expect(parseDueWord("5jan", TODAY)).toBe("2027-01-05");
    expect(parseDueWord("2026-11-02", TODAY)).toBe("2026-11-02");
  });

  it("returns null for anything else", () => {
    expect(parseDueWord("soon", TODAY)).toBeNull();
    expect(parseDueWord("40oct", TODAY)).toBeNull();
  });
});

describe("parseQuickAdd", () => {
  it("pulls out @due, #ref and !priority, leaving the title", () => {
    expect(parseQuickAdd("Chase invoice @fri #PO-2026-0153 !1", TODAY)).toEqual({
      title: "Chase invoice",
      dueDate: "2026-10-16",
      priority: 1,
      ref: "PO-2026-0153",
    });
  });

  it("defaults to priority 2 with no date or link", () => {
    expect(parseQuickAdd("  Order toner  ", TODAY)).toEqual({
      title: "Order toner",
      dueDate: null,
      priority: 2,
      ref: null,
    });
  });

  it("keeps words that only look like shortcuts", () => {
    expect(parseQuickAdd("Email a@b.com about !4 boxes", TODAY).title).toBe(
      "Email a@b.com about !4 boxes",
    );
    expect(parseQuickAdd("Meet @soon", TODAY)).toMatchObject({
      title: "Meet @soon",
      dueDate: null,
    });
  });
});

describe("overdue and grouping (rule 6)", () => {
  it("is overdue only before today and only while not done", () => {
    expect(isOverdue("2026-10-12", "open", TODAY)).toBe(true);
    expect(isOverdue("2026-10-13", "open", TODAY)).toBe(false);
    expect(isOverdue("2026-10-12", "done", TODAY)).toBe(false);
    expect(isOverdue(null, "open", TODAY)).toBe(false);
  });

  it("groups by due date: overdue, this week (to Sunday), later, none", () => {
    expect(endOfWeek(TODAY)).toBe("2026-10-18");
    expect(dueGroup("2026-10-08", TODAY)).toBe("overdue");
    expect(dueGroup("2026-10-13", TODAY)).toBe("week");
    expect(dueGroup("2026-10-18", TODAY)).toBe("week");
    expect(dueGroup("2026-10-19", TODAY)).toBe("later");
    expect(dueGroup(null, TODAY)).toBe("none");
  });

  it("formats due dates like the design", () => {
    expect(formatDue("2026-10-14", TODAY)).toBe("Wed 14 Oct");
    expect(formatDue("2026-10-08", TODAY)).toBe("8 Oct");
    expect(formatDue("2026-10-30", TODAY)).toBe("30 Oct");
    expect(formatDue("2027-01-05", TODAY)).toBe("5 Jan 2027");
  });
});

describe("sourceShortLabel", () => {
  it("drops the person when Related already names them", () => {
    expect(sourceShortLabel("Offboarding · Karim Saleh", "Karim Saleh")).toBe("Offboarding");
    expect(sourceShortLabel("Onboarding · Priya Nair", "Priya Nair")).toBe("Onboarding");
  });
  it("keeps the full label otherwise", () => {
    expect(sourceShortLabel("Offboarding · Karim Saleh", null)).toBe("Offboarding · Karim Saleh");
    expect(sourceShortLabel("Offboarding · Karim Saleh", "Someone Else")).toBe(
      "Offboarding · Karim Saleh",
    );
    expect(sourceShortLabel("Manual", "Karim Saleh")).toBe("Manual");
  });
});
