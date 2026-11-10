import { describe, expect, it } from "vitest";
import { checkSeatRows, parseSeatList, parseTier, skippedNote } from "./seat-import";

const ok = (text: string) => {
  const parsed = parseSeatList(text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.rows;
};

describe("parseSeatList", () => {
  it("reads Name, Seat, Project by header", () => {
    expect(ok("Project,Name,Seat\nBidding,Sara,Premium\n")).toEqual([
      { name: "Sara", seat: "Premium", project: "Bidding", status: "" },
    ]);
  });
  it("reads Claude's admin export: the email is the person, Seat Tier the tier", () => {
    const rows = ok(
      '"Name","Email","Role","Status","Seat Tier"\n"Sara H","sara@example.com","Member","Active","Premium"\n"Omar","omar@example.com","Admin","Active","unassigned"\n',
    );
    expect(rows[0]).toEqual({
      name: "sara@example.com",
      seat: "Premium",
      project: "",
      status: "Active",
    });
    expect(rows[1]!.seat).toBe("unassigned");
  });
  it("reads a headerless two-column paste (comma or tab)", () => {
    expect(ok("sara@example.com, Premium\nomar@example.com, Standard")).toEqual([
      { name: "sara@example.com", seat: "Premium", project: "", status: "" },
      { name: "omar@example.com", seat: "Standard", project: "", status: "" },
    ]);
    expect(ok("sara@example.com\tPremium\tBidding")[0]).toMatchObject({ project: "Bidding" });
  });
  it("needs a Seat column when there is a header, and some text", () => {
    expect(parseSeatList("Name,Project\nSara,Bidding")).toEqual({
      error: "The header row needs a Seat column (Standard or Premium).",
    });
    expect("error" in parseSeatList("  \n")).toBe(true);
  });
});

describe("checkSeatRows", () => {
  const row = (name: string, seat: string, project = "", status?: string) => ({
    name,
    seat,
    project,
    status,
  });
  it("accepts valid rows and trims them", () => {
    const { rows, problems } = checkSeatRows(
      [row(" Sara ", "premium", "Bidding"), row("Omar", "Std")],
      [],
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { name: "Sara", tier: "premium", project: "Bidding" },
      { name: "Omar", tier: "standard", project: null },
    ]);
  });
  it("reports an unknown or empty seat type, an empty name, a repeat and an active holder", () => {
    const { rows, problems } = checkSeatRows(
      [
        row("Sara", "Gold"),
        row("Omar", ""),
        row("", "Standard"),
        row("Lina", "Standard"),
        row("lina", "Premium"),
        row("Karim", "Standard"),
      ],
      ["KARIM"],
    );
    expect(rows).toHaveLength(1);
    expect(problems.map((p) => p.row)).toEqual([1, 2, 3, 5, 6]);
    expect(problems[0]!.message).toContain("unknown seat type");
    expect(problems[3]!.message).toBe("lina repeats row 4.");
    expect(problems[4]!.message).toBe("Karim already holds an active seat.");
  });
  it("skips Unassigned members and rows that are not Active, and counts them", () => {
    const result = checkSeatRows(
      [
        row("a@x.com", "Premium", "", "Active"),
        row("b@x.com", "Unassigned", "", "Active"),
        row("c@x.com", "Unassigned", "", "Active"),
        row("d@x.com", "Standard", "", "Pending"),
      ],
      [],
    );
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.unassigned).toBe(2);
    expect(result.inactive).toBe(1);
    expect(skippedNote(17, 0)).toBe("17 unassigned members skipped");
    expect(skippedNote(1, 2)).toBe("1 unassigned member skipped · 2 not active skipped");
    expect(skippedNote(0, 0)).toBeNull();
  });
  it("parses tiers loosely", () => {
    expect(parseTier(" PREMIUM ")).toBe("premium");
    expect(parseTier("unassigned")).toBeNull();
  });
});
