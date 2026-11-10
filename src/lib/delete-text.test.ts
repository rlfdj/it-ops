import { describe, expect, it } from "vitest";
import { countOf, deleteDescription, deleteTitle, joinList } from "./delete-text";

describe("delete wording", () => {
  it("counts and joins", () => {
    expect(countOf(1, "invoice")).toBe("1 invoice");
    expect(countOf(6, "invoice")).toBe("6 invoices");
    expect(countOf(2, "person", "people")).toBe("2 people");
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("names what goes with the record", () => {
    expect(deleteTitle("ChatGPT Business")).toBe("Delete ChatGPT Business?");
    expect(deleteDescription({ deletes: ["6 invoices", "6 attached files"], keeps: [] })).toBe(
      "This also deletes 6 invoices and 6 attached files. This can’t be undone.",
    );
  });

  it("says what stays, and handles a record with nothing attached", () => {
    expect(deleteDescription({ deletes: [], keeps: [] })).toBe("This can’t be undone.");
    expect(
      deleteDescription({ deletes: ["1 invoice"], keeps: ["2 linked tasks stay, unlinked."] }),
    ).toBe("This also deletes 1 invoice. 2 linked tasks stay, unlinked. This can’t be undone.");
  });
});
