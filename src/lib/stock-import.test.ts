import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import { parseStockCsv } from "./stock-import";

describe("parseCsv", () => {
  it("handles quotes, commas, newlines in cells, CRLF and BOM", () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line\nbreak", "z"],
    ]);
  });
  it("round-trips toCsv", () => {
    expect(parseCsv(toCsv(["h1", "h2", "h3"], [["a,b", 'q"r', ""]]))[1]).toEqual([
      "a,b",
      'q"r',
      "",
    ]);
  });
});

describe("parseStockCsv", () => {
  it("maps columns by header, in any order, ignoring extras", () => {
    const r = parseStockCsv("Model,Tag,Added,Serial number\nMX Keys,DP-1,13 Oct 2026,SN1\n");
    expect(r).toEqual({
      rows: [{ tag: "DP-1", model: "MX Keys", serialNumber: "SN1", specifications: "", notes: "" }],
    });
  });
  it("needs Tag and Model headers", () => {
    expect(parseStockCsv("Name,Qty\nx,1")).toMatchObject({ error: expect.stringContaining("Tag") });
    expect(parseStockCsv("")).toMatchObject({ error: "The file is empty." });
  });
});
