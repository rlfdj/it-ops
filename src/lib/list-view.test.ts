import { describe, expect, it } from "vitest";
import {
  filterRows,
  matchesQuery,
  nextSort,
  parseSort,
  sortParam,
  sortRows,
  textParam,
} from "./list-view.ts";

describe("sort param", () => {
  it("reads ascending, descending and rejects unknown keys", () => {
    expect(parseSort("amount", ["amount"])).toEqual({ key: "amount", dir: "asc" });
    expect(parseSort("-amount", ["amount"])).toEqual({ key: "amount", dir: "desc" });
    expect(parseSort("bogus", ["amount"])).toBeNull();
    expect(parseSort(undefined, ["amount"])).toBeNull();
  });
  it("round-trips", () => {
    expect(sortParam({ key: "due", dir: "desc" })).toBe("-due");
    expect(sortParam({ key: "due", dir: "asc" })).toBe("due");
    expect(sortParam(null)).toBeNull();
  });
  it("cycles first direction, the opposite, then back to default", () => {
    const a = nextSort(null, "amount", "desc");
    expect(a).toEqual({ key: "amount", dir: "desc" });
    const b = nextSort(a, "amount", "desc");
    expect(b).toEqual({ key: "amount", dir: "asc" });
    expect(nextSort(b, "amount", "desc")).toBeNull();
    expect(nextSort(b, "vendor")).toEqual({ key: "vendor", dir: "asc" });
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "b", v: 2 },
    { n: "a", v: null },
    { n: "c", v: 10 },
    { n: "d", v: 2 },
  ];
  const getters = { n: (r: (typeof rows)[number]) => r.n, v: (r: (typeof rows)[number]) => r.v };
  it("sorts numbers, keeps ties in order and puts empties last", () => {
    expect(sortRows(rows, { key: "v", dir: "asc" }, getters).map((r) => r.n)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
    expect(sortRows(rows, { key: "v", dir: "desc" }, getters).map((r) => r.n)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });
  it("sorts text naturally and leaves the input untouched", () => {
    const out = sortRows(rows, { key: "n", dir: "desc" }, getters);
    expect(out.map((r) => r.n)).toEqual(["d", "c", "b", "a"]);
    expect(rows[0]!.n).toBe("b");
  });
  it("returns the rows as they are without a sort", () => {
    expect(sortRows(rows, null, getters)).toBe(rows);
  });
});

describe("text filter", () => {
  it("needs every word, in any field, ignoring case", () => {
    expect(matchesQuery("dell mon", ["PO-1", "Dell Technologies", "2 × Monitor"])).toBe(true);
    expect(matchesQuery("dell cable", ["PO-1", "Dell Technologies", "2 × Monitor"])).toBe(false);
    expect(matchesQuery("  ", ["x"])).toBe(true);
    expect(matchesQuery("x", [null, undefined])).toBe(false);
  });
  it("filters rows and trims the search param", () => {
    expect(filterRows(["Alpha", "Beta"], "alp", (s) => [s])).toEqual(["Alpha"]);
    expect(filterRows(["Alpha"], "", (s) => [s])).toEqual(["Alpha"]);
    expect(textParam([" a ", "b"])).toBe("a");
    expect(textParam(undefined)).toBe("");
  });
});
