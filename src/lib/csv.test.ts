import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes cells with commas, quotes and newlines", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x, y", 'say "hi"'],
          ["line\nbreak", null],
        ],
      ),
    ).toBe('a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it("neutralises values that a spreadsheet would run as formulas", () => {
    expect(toCsv(["v"], [["=1+1"], ["-5"], [5]])).toBe("v\r\n'=1+1\r\n'-5\r\n5\r\n");
  });
});
