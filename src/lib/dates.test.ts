import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatDate,
  startOfDayIn,
  todayIn,
  todayInDubai,
  yearIn,
  yearInDubai,
} from "./dates";

describe("todayInDubai", () => {
  it("uses Dubai time (UTC+4), not UTC", () => {
    // 21:30 UTC on 31 Dec is already 1 Jan in Dubai.
    const instant = new Date("2026-12-31T21:30:00Z");
    expect(todayInDubai(instant)).toBe("2027-01-01");
    expect(yearInDubai(instant)).toBe(2027);
  });

  it("stays on the same day before 20:00 UTC", () => {
    expect(todayInDubai(new Date("2026-10-13T19:59:00Z"))).toBe("2026-10-13");
  });
});

describe("formatDate", () => {
  it("formats calendar dates like 13 Oct 2026", () => {
    expect(formatDate("2026-10-13")).toBe("13 Oct 2026");
    expect(formatDate("2027-01-09")).toBe("9 Jan 2027");
    // ICU en-GB would say "Sept"; the app always uses three letters.
    expect(formatDate("2026-09-22")).toBe("22 Sep 2026");
  });

  it("formats instants in Dubai time", () => {
    expect(formatDate(new Date("2026-10-12T22:00:00Z"))).toBe("13 Oct 2026");
  });
});

describe("todayIn a workspace time zone", () => {
  const instant = new Date("2026-12-31T21:30:00Z");

  it("follows the zone, not UTC", () => {
    expect(todayIn("Asia/Dubai", instant)).toBe("2027-01-01");
    expect(todayIn("UTC", instant)).toBe("2026-12-31");
    expect(todayIn("America/New_York", instant)).toBe("2026-12-31");
    expect(todayIn("Asia/Manila", instant)).toBe("2027-01-01");
    expect(todayIn("Pacific/Kiritimati", new Date("2026-12-31T10:30:00Z"))).toBe("2027-01-01");
  });

  it("gives the year for numbering in that zone", () => {
    expect(yearIn("Asia/Dubai", instant)).toBe(2027);
    expect(yearIn("Europe/London", instant)).toBe(2026);
  });

  it("keeps the Dubai names working, with an optional zone", () => {
    expect(todayInDubai(instant)).toBe(todayIn("Asia/Dubai", instant));
    expect(yearInDubai(instant)).toBe(2027);
    expect(todayInDubai(instant, "UTC")).toBe("2026-12-31");
  });

  it("formats instants in the given zone", () => {
    const at = new Date("2026-10-12T22:00:00Z");
    expect(formatDate(at, "Asia/Dubai")).toBe("13 Oct 2026");
    expect(formatDate(at, "America/New_York")).toBe("12 Oct 2026");
    expect(formatDate("2026-10-13", "America/New_York")).toBe("13 Oct 2026");
  });

  it("finds when a calendar date starts in a zone, with daylight saving", () => {
    expect(startOfDayIn("2026-10-13", "Asia/Dubai").toISOString()).toBe("2026-10-12T20:00:00.000Z");
    expect(startOfDayIn("2026-07-01", "America/New_York").toISOString()).toBe(
      "2026-07-01T04:00:00.000Z",
    );
    expect(startOfDayIn("2026-12-01", "America/New_York").toISOString()).toBe(
      "2026-12-01T05:00:00.000Z",
    );
    expect(startOfDayIn("2026-10-13", "UTC").toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });
});

describe("day arithmetic", () => {
  it("counts days between calendar dates", () => {
    expect(daysBetween("2026-10-13", "2026-10-27")).toBe(14);
    expect(daysBetween("2026-10-13", "2026-10-10")).toBe(-3);
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});
